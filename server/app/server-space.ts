import { serverInboxRoutes } from '../http/server-inbox-routes.ts'
import { sourceReviewRoutes } from '../http/source-review-routes.ts'
import { sourceReviewKey } from '../notices/source-review.ts'
import { codeRequestKey, freshRequest } from '../notices/code-request.ts'
import type express from 'express'
import { DEFAULT_ACCOUNT_ID } from '../db/household-scope.ts'
import { mailRoutes } from '../http/mail-routes.ts'
import { pluginRoutes, pluginServerRoutes } from '../http/plugin-routes.ts'
import { requireServerAdmin } from '../http/profile-routes.ts'
import { accountAsking } from '../http/proof.ts'
import { serverNoticeRoutes } from '../http/server-notice-routes.ts'
import { serverRoutes } from '../http/server-routes.ts'
import type { Wiring } from './wiring.ts'

const mountPlugins = (api: express.Router, wiring: Wiring) => {
  const { plugins, pluginInstaller, pluginAi, accounts } = wiring.options
  if (!plugins) return
  api.use(
    '/plugins',
    pluginRoutes(plugins, {
      ...pluginInstaller,
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
      coreKinds: ['code-request', 'source-review', 'weekly-report'],
      plugins: noticePlugins(plugins),
      mailReady: () => serverMail?.store.get() != null,
      publicKey: serverNotices.publicKey || null,
      now
    })
  )
}

// À traiter's sources: the decision on each, and Serveur › Contenu's « Valider les sources ».
const mountReviews = (api: express.Router, { options }: Wiring) => {
  const { sources, news, users, profiles, serverInbox, now } = options
  if (!sources?.reviews) return
  api.use(
    '/server/reviews',
    requireServerAdmin,
    sourceReviewRoutes({
      reviews: sources.reviews,
      news,
      sources: sources.store,
      onAccepted: () => profiles?.list().forEach(profile => users?.(profile.id).sources.catalogueChanged(now())),
      onDecided: sourceId => serverInbox?.notifier.handled?.(sourceReviewKey(sourceId)),
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
        home: () => options.serverSettings?.publicHome() ?? null,
        now
      })
    )
  }
  mountNotices(api, wiring)
  const inbox = options.serverInbox?.store
  if (inbox) api.use('/server/inbox', requireServerAdmin, serverInboxRoutes(inbox))
  mountReviews(api, wiring)
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
      ...(inbox
        ? {
            codeRequests: {
              askedAt: (id: number) => freshRequest(inbox.waiting(codeRequestKey(id)), now()),
              handled: (id: number) => inbox.handle(codeRequestKey(id), now())
            }
          }
        : {}),
      ...(twoFactor ? { twoFactorOn: (id: number) => twoFactor.isOn(id) } : {}),
      ...deletionsOf(wiring),
      now
    })
  )
}
