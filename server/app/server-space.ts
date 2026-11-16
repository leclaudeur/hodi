import type express from 'express'
import { clearedProfileCookie } from '../auth/session.ts'
import { DEFAULT_ACCOUNT_ID } from '../db/household-scope.ts'
import { mailRoutes } from '../http/mail-routes.ts'
import { pluginRoutes, pluginServerRoutes } from '../http/plugin-routes.ts'
import { requireServerAdmin } from '../http/profile-routes.ts'
import { accountAsking } from '../http/proof.ts'
import { serverNoticeRoutes } from '../http/server-notice-routes.ts'
import { serverRoutes } from '../http/server-routes.ts'
import type { Wiring } from './wiring.ts'

// « Changer de foyer », a plugin's moveDevice: this device reads in that household from now on, when its account has
// a profile there. Its profile is chosen again in « Qui lit ? ». null: refused, nothing changed.
const moveDeviceOf =
  ({ options, session }: Wiring) =>
  (request: express.Request, householdId: number) => {
    const { accounts, devices } = options
    const asking = session.sessionOf(request)
    if (!asking?.device || !accounts || !devices) return null
    if (accounts.profileOf(asking.account.id, householdId) === null) return null
    devices.moveTo(asking.account.id, asking.device.id, householdId)
    return [clearedProfileCookie()]
  }

const mountPlugins = (api: express.Router, wiring: Wiring) => {
  const { plugins, pluginInstaller, pluginAi, accounts } = wiring.options
  if (!plugins) return
  api.use(
    '/plugins',
    pluginRoutes(plugins, {
      ...pluginInstaller,
      moveDevice: moveDeviceOf(wiring),
      ...(pluginAi ? { ai: pluginAi } : {}),
      ...(accounts
        ? {
            proof: async (request, response) => (await wiring.serverProof(request, response)) !== null,
            routeProof: wiring.pluginRouteProof
          }
        : {})
    })
  )
  // A plugin's sections of /server reach its own routes there, for the server's admin only.
  api.use(
    '/server/plugins',
    requireServerAdmin,
    pluginServerRoutes(plugins, accounts ? { routeProof: wiring.pluginRouteProof } : {})
  )
}

// What deleting an account or a household from Serveur › Comptes and Foyers sets off.
const deletionsOf = ({ options, profileHooks }: Wiring) => {
  const { accountData, plugins, serverSettings } = options
  if (!accountData) return {}
  return {
    deletions: {
      data: accountData,
      onProfileDeleted: profileHooks.deleted,
      onAccountDeleted: (id: number) => plugins?.accountDeleted(id),
      onHouseholdGone: (id: number) => {
        plugins?.householdRemoved(id)
        // The core's household left as a new install's: its server's admin goes on in /server, where
        // « Créer un foyer » starts it again.
        if (id === DEFAULT_ACCOUNT_ID) serverSettings?.setHouseholdLater(true)
      }
    }
  }
}

// The plugins that tell the server's admin of events: loaded, and allowed to.
const noticePlugins = (plugins: Wiring['options']['plugins']) => () =>
  (plugins?.list() ?? []).flatMap(({ id, manifest, sandbox, translations }) =>
    manifest?.permissions.notify && sandbox && manifest.serverNotifications.length > 0
      ? [{ id, name: manifest.name, translations, kinds: manifest.serverNotifications }]
      : []
  )

const mountNotices = (api: express.Router, { options }: Wiring) => {
  const { serverNotices, serverMail, plugins, accounts, now } = options
  if (!serverNotices || !accounts) return
  api.use(
    '/server/notifications',
    requireServerAdmin,
    serverNoticeRoutes({
      store: serverNotices.store,
      accountOf: response => accountAsking(response, accounts)?.id ?? null,
      coreKinds: ['weekly-report'],
      plugins: noticePlugins(plugins),
      mailReady: () => serverMail?.store.get() != null,
      publicKey: serverNotices.publicKey || null,
      now
    })
  )
}

// /server, for the server's admin, and the plugins' own routes.
export const mountServerSpace = (api: express.Router, wiring: Wiring) => {
  const { options } = wiring
  const { serverMail, accounts, news, now, serverStats, profiles, household, codes, twoFactor } = options
  mountPlugins(api, wiring)
  if (serverMail && accounts) {
    api.use(
      '/server/mail',
      requireServerAdmin,
      mailRoutes({
        mail: serverMail.store,
        send: serverMail.send,
        accounts,
        languageOf: profileId => news.languageOf(profileId),
        now
      })
    )
  }
  mountNotices(api, wiring)
  if (!serverStats) return
  api.use(
    '/server',
    requireServerAdmin,
    serverRoutes({
      stats: serverStats,
      presence: wiring.presence,
      profiles,
      household,
      people: options.serverPeople,
      codes,
      settings: options.serverSettings,
      backups: options.serverBackups,
      accounts,
      onHouseholdSetUp: language => {
        wiring.householdOptions?.onSetUp?.(language)
        options.onHouseholdChange()
      },
      checkProof: wiring.checkProof,
      ...(twoFactor ? { twoFactorOn: (id: number) => twoFactor.isOn(id) } : {}),
      ...deletionsOf(wiring),
      now
    })
  )
}
