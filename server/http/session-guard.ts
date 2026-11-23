import type express from 'express'
import type { RequestHandler } from 'express'
import { PROFILE_COOKIE, readCookie, readProfileToken } from '../auth/session.ts'
import { DEFAULT_ACCOUNT_ID, inHousehold } from '../db/household-scope.ts'
import type { InstallStore } from '../db/install-store.ts'
import type { Profile, ProfileStore } from '../db/profile-store.ts'
import type { ServerSettingsStore } from '../db/server-settings-store.ts'
import type { ServerStatsStore } from '../db/server-stats-store.ts'
import type { UserAccount, UserAccountStore } from '../db/user-account-store.ts'
import type { UserDeviceStore } from '../db/user-device-store.ts'
import type { accountSession } from './account-session.ts'
import type { Presence } from './presence.ts'
import { isHere } from './profile-current-routes.ts'
import { giveOwnProfile } from './own-profile.ts'
import { guardOf, youngHereOf } from './profile-guard.ts'

export interface SessionGuardOptions {
  accounts?: UserAccountStore
  devices?: UserDeviceStore
  profiles?: ProfileStore
  install: InstallStore
  serverSettings?: ServerSettingsStore
  serverStats?: ServerStatsStore
  presence: Presence
  sessionOf: ReturnType<typeof accountSession>['sessionOf']
  // Every account signed in on this device; absent in tests without accounts.
  sessionsOf?: ReturnType<typeof accountSession>['sessionsOf']
  cookieFor: ReturnType<typeof accountSession>['cookieFor']
  secret: Buffer
  now: () => number
  // Called with the profile an account without one gets as it signs in.
  onProfileCreated?: (profileId: number) => void
}

// What "Qui lit ?" asks before a profile is open on the device.
const isQuiLit = (request: express.Request) =>
  (request.method === 'GET' && request.path === '/session') ||
  (request.method === 'GET' && request.path === '/profiles') ||
  (request.method === 'GET' && /^\/profiles\/\d+\/photo$/.test(request.path)) ||
  (request.method === 'GET' && /^\/households\/\d+\/photo$/.test(request.path)) ||
  (request.method === 'PUT' && request.path === '/profiles/current')

// Everything registered after this middleware requires a valid session.
// The server's admin in the middle of the setup, before their profile: /server alone. False when the refusal is sent.
const serverOnly = (request: express.Request, response: express.Response, account: UserAccount) => {
  const open =
    (request.method === 'GET' && request.path === '/session') ||
    // « Validation en deux étapes », which /server needs first.
    request.path.startsWith('/account/two-factor') ||
    request.path.startsWith('/server/') ||
    // The topics, sources and icons that Serveur › Vue d'ensemble shows: every one refused would add up, at each
    // opening, to the burst of errors a proxy such as CrowdSec bans as probing.
    (request.method === 'GET' && /^\/(topics|sources|sources\/[^/]+\/icon)$/.test(request.path)) ||
    request.path === '/plugins' ||
    request.path.startsWith('/plugins/')
  if (!open) {
    // 423, not 403: the device's state, which a proxy such as CrowdSec would otherwise count as probing.
    response.status(423).json({ error: 'no_household' })
    return false
  }
  response.locals.accountId = account.id
  response.locals.serverOnly = true
  return true
}

const householdHelpers = ({ accounts }: Pick<SessionGuardOptions, 'accounts'>) => {
  // The household a signed-in device reads in: its account's own, the only one it has.
  const householdOfSession = ({ account }: { account: UserAccount }) =>
    accounts ? accounts.householdOf(account.id) : null

  return { householdOfSession }
}

// Before the server is set up: the server's admin alone, for /server and the setup steps.
const answerBeforeSetup = (
  { accounts, sessionOf }: Pick<SessionGuardOptions, 'accounts' | 'sessionOf'>,
  request: express.Request,
  response: express.Response,
  next: express.NextFunction
) => {
  // In the middle of the setup, once the server's admin has their account: a plugin's setup steps read its
  // plugins and their server routes, and the core's e-mail step Serveur › E-mail. Never the session itself, which
  // keeps saying the setup is not over.
  const forSetupSteps =
    request.path.startsWith('/server/') ||
    request.path === '/plugins' ||
    request.path.startsWith('/plugins/') ||
    // « Protège le compte », right after the server admin's account.
    request.path.startsWith('/account/two-factor')
  const admin = forSetupSteps && accounts?.any() ? sessionOf(request) : null
  if (admin?.account.serverAdmin) {
    if (serverOnly(request, response, admin.account)) next()
    return
  }
  response.status(401).json({ error: 'setup_required' })
}

const requireSessionOf = (options: SessionGuardOptions): RequestHandler => {
  const { accounts, devices, sessionOf, cookieFor } = options
  const { householdOfSession } = householdHelpers(options)
  return (request, response, next) => {
    if (!options.install.isSetUp()) {
      answerBeforeSetup(options, request, response, next)
      return
    }

    // From here on, the request is for one household: its account's. Every store of one household's data reads
    // that one (household-scope.ts).
    const session = sessionOf(request)
    if (session) {
      // Every account reads with a profile of its own: one made by a plugin, or whose profile was deleted, gets one now.
      if (accounts && options.profiles) giveOwnProfile(accounts, options.profiles, session.account, options)
      const householdId = householdOfSession(session) ?? DEFAULT_ACCOUNT_ID
      response.locals.accountId = session.account.id
      // A session from before devices were kept: this device gets its row in Appareils, and a cookie naming it.
      if (!session.device && devices) response.append('Set-Cookie', cookieFor(session.account, request))
      inHousehold(householdId, next)
      return
    }

    response.status(401).json({ error: 'unauthenticated' })
  }
}

// Before the setup is over: no profile yet, the server's admin and nothing else.
const serverOnlyLocals = (response: express.Response) => {
  response.locals.profileId = 0
  response.locals.serverAdmin = true
  response.locals.profileChosen = false
}

// The profile a request is for, and whether it is chosen on this device or the device reads as nobody.
const profileOfRequest = (
  {
    accounts,
    devices,
    profiles,
    sessionsOf,
    secret
  }: Pick<SessionGuardOptions, 'accounts' | 'devices' | 'profiles' | 'sessionsOf' | 'secret'>,
  request: express.Request
) => {
  const token = readProfileToken(
    readCookie(request.get('cookie'), PROFILE_COOKIE),
    secret,
    id => profiles?.lock(id)?.version ?? 0
  )
  const known = profiles?.list() ?? []
  const sessions = sessionsOf ? sessionsOf(request) : []
  const signedIn = sessions.map(session => session.account.id)
  const youngHere = youngHereOf(sessions, accounts, devices)
  const here = (candidate: Profile) =>
    isHere({ accounts, signedInHere: sessionsOf && (() => signedIn) }, candidate, request)
  // An adult whose account is not signed in here never opens on this device.
  const isGuarded = (candidate: Profile) => !here(candidate) || guardOf(candidate, accounts, youngHere) !== null
  const chosen = token
    ? known.find(candidate => candidate.id === token.id && here(candidate) && (token.signed || !isGuarded(candidate)))
    : undefined
  const profile = chosen ?? known.find(candidate => !isGuarded(candidate)) ?? known[0]
  // Only profiles that ask for a password, and none given here: the device reads as nobody, with no right of any
  // profile.
  const locked = profile !== undefined && isGuarded(profile) && !chosen
  return { chosen, profile, locked }
}

// The profile each request is for: the device's choice, or the first profile that asks for no password until it
// has made one. A profile that asks for one counts as chosen only with a cookie signed for its current version.
const chooseProfileOf = (options: SessionGuardOptions): RequestHandler => {
  const { accounts, serverStats, presence, now } = options
  return (request, response, next) => {
    if (response.locals.serverOnly === true) {
      serverOnlyLocals(response)
      next()
      return
    }
    const { chosen, profile, locked } = profileOfRequest(options, request)
    response.locals.profileId = profile?.id ?? 1
    // The server's admin is an account: the profile opened here must be that account's, so another adult opening
    // their own profile on the same device never gets it. Without accounts (older tests), the first profile stands for it.
    response.locals.serverAdmin = locked
      ? false
      : accounts
        ? profile !== undefined && accounts.ofProfile(profile.id)?.serverAdmin === true
        : (profile?.role ?? 'admin') === 'admin'
    response.locals.kind = profile?.kind ?? 'adult'
    // false: this device has not chosen yet, the app asks "Qui lit ?".
    response.locals.profileChosen = chosen !== undefined
    // Nothing but "Qui lit ?" answers: the list, the photos and the choice of a profile with its code.
    if (locked && !isQuiLit(request)) {
      // 423, not 403: every request of the app at once would otherwise be a burst of 403s, which a proxy such as
      // CrowdSec bans as probing.
      response.status(423).json({ error: 'profile_locked' })
      return
    }
    // A profile opened here: it counts in the server's visits of the day and as online, as numbers only.
    if (chosen !== undefined) {
      presence.seen(chosen.id, request.get('user-agent') ?? '', now())
      serverStats?.recordVisit(chosen.id, now())
    }
    next()
  }
}

// Who a request reads as: requireSession lets in a signed-in device, in its household;
// chooseProfile then says which profile of that household it is for.
export const sessionGuards = (options: SessionGuardOptions) => ({
  requireSession: requireSessionOf(options),
  chooseProfile: chooseProfileOf(options)
})
