import type express from 'express'
import { currentHouseholdId } from '../db/household-scope.ts'
import { profileCookie, profileToken } from '../auth/session.ts'
import { accountRoutes } from '../http/account-routes.ts'
import { codeRoutes } from '../http/code-routes.ts'
import { householdRoutes } from '../http/household-routes.ts'
import { householdPhotoRoutes } from '../http/household-photo.ts'
import { profileDeviceRoutes } from '../http/profile-device-routes.ts'
import { profileRoutes, requireAdmin } from '../http/profile-routes.ts'
import { sessionRoutes } from '../http/session-routes.ts'
import { sourceRequestMeRoutes, sourceRequestRoutes } from '../http/source-request-routes.ts'
import { youthGate, youthMeRoutes, youthProfileRoutes } from '../http/youth-routes.ts'
import { textsIn } from '../i18n.ts'
import type { Wiring } from './wiring.ts'

// Réglages › Compte et données.
const mountAccount = (api: express.Router, { options, config, session, profileHooks }: Wiring) => {
  const { accounts, devices, accountData, profiles, household, throttle, now, plugins, twoFactor } = options
  if (!accounts || !devices || !accountData) return
  api.use(
    '/account',
    accountRoutes({
      data: accountData,
      accounts,
      devices,
      profiles,
      household,
      sessionOf: session.sessionOf,
      cookieForDevice: session.cookieForDevice,
      profileCookieFor: id => profileCookie(profileToken(id, profiles?.lock(id)?.version ?? 0, config.sessionSecret)),
      throttle,
      now,
      onDeleteProfile: id => profileHooks.deleted(id),
      onAccountDeleted: id => plugins?.accountDeleted(id),
      // Deleting the last adult's account empties the household: the plugins forget it as a removed one.
      onHouseholdGone: () => plugins?.householdRemoved(currentHouseholdId()),
      pluginCopies: plugins ? who => plugins.exportData(who) : undefined,
      twoFactor
    })
  )
}

const mountProfiles = (api: express.Router, wiring: Wiring) => {
  const { profiles, profileDevices, youth, users, accounts, pinThrottle, now } = wiring.options
  if (!profiles) return
  if (profileDevices) api.use('/profiles', profileDeviceRoutes({ devices: profileDevices, profiles, now }))
  api.use(
    '/profiles',
    profileRoutes({
      profiles,
      now,
      secret: wiring.config.sessionSecret,
      pinThrottle,
      accounts,
      signIn: accounts ? wiring.session.cookieFor : undefined,
      onCreate: wiring.profileHooks.created,
      onChange: profile => wiring.youthSources?.start(profile),
      onDelete: wiring.profileHooks.deleted,
      checkProof: wiring.checkProof
    })
  )
  if (youth) {
    api.use('/profiles', youthProfileRoutes({ youth, sources: wiring.youthSources ?? undefined, profiles, users, now }))
  }
}

// "Demander une source": a teen asks, its parents answer in Réglages ("Demandes").
const mountSourceRequests = (api: express.Router, { options, youthSources }: Wiring) => {
  const { youth, profiles, sources, news, household, alerts, now } = options
  if (!youth || !youthSources || !profiles || !sources) return
  api.use(
    '/me',
    sourceRequestMeRoutes({
      youth,
      find: sources.find,
      news,
      now,
      // Every parent's devices hear of it.
      onRequest: request => {
        const t = textsIn(household.get().language)
        const name = profiles.get(request.profileId)?.name ?? ''
        for (const parent of profiles.list().filter(profile => profile.kind === 'adult')) {
          void alerts?.notifyShare(parent.id, {
            title: t('requests.push', { name, source: request.source.name }),
            body: request.source.url,
            url: `#/settings/requests/${request.id}`,
            tag: `request:${request.id}`,
            badge: null
          })
        }
      }
    })
  )
  api.use('/source-requests', sourceRequestRoutes({ youth, sources: youthSources, news, profiles, now }))
}

// A household a plugin makes: its base sources and its admin's profile set up as the core's.
const fillHouseholdHooks = ({ options, householdOptions, profileHooks }: Wiring) => {
  const { householdHooks, plugins } = options
  if (!householdHooks) return
  householdHooks.setUp = language => householdOptions?.onSetUp?.(language)
  householdHooks.profileCreated = profileHooks.created
  householdHooks.profileDeleted = profileHooks.deleted
  householdHooks.removed = id => plugins?.householdRemoved(id)
}

// The signed-in household's own routes: the session, the account, profiles and young profiles' rules.
export const mountHousehold = (api: express.Router, wiring: Wiring) => {
  const { youth, accounts, household, serverSettings, twoFactor, codes, profiles, now } = wiring.options
  // A young profile reads within its parents' rules.
  if (youth) {
    api.use(youthGate(youth, now))
    api.use('/me', youthMeRoutes({ youth, now }))
  }
  api.use(sessionRoutes({ accounts, household, serverSettings, twoFactor }))
  mountAccount(api, wiring)
  if (codes && profiles)
    api.use('/codes', codeRoutes({ codes, profiles, accounts, now, checkProof: wiring.checkProof }))
  fillHouseholdHooks(wiring)
  mountProfiles(api, wiring)
  mountSourceRequests(api, wiring)
  api.use(householdPhotoRoutes({ household, profiles, accounts }))
  if (wiring.householdOptions) api.use('/household', requireAdmin, householdRoutes(wiring.householdOptions))
}
