import type express from 'express'
import type { RequestHandler } from 'express'
import { PROFILE_COOKIE, readCookie, readProfileToken } from '../auth/session.ts'
import { DEFAULT_ACCOUNT_ID, inHousehold } from '../db/household-scope.ts'
import type { HouseholdStore } from '../db/household-store.ts'
import type { Profile, ProfileStore } from '../db/profile-store.ts'
import type { ServerSettingsStore } from '../db/server-settings-store.ts'
import type { ServerStatsStore } from '../db/server-stats-store.ts'
import type { UserAccount, UserAccountStore } from '../db/user-account-store.ts'
import type { UserDevice, UserDeviceStore } from '../db/user-device-store.ts'
import type { accountSession } from './account-session.ts'
import type { Presence } from './presence.ts'
import type { profileDeviceSession } from './profile-device-session.ts'
import { guardOf } from './profile-guard.ts'

export interface SessionGuardOptions {
  accounts?: UserAccountStore
  devices?: UserDeviceStore
  profiles?: ProfileStore
  household: HouseholdStore
  serverSettings?: ServerSettingsStore
  serverStats?: ServerStatsStore
  presence: Presence
  sessionOf: ReturnType<typeof accountSession>['sessionOf']
  cookieFor: ReturnType<typeof accountSession>['cookieFor']
  linkedDevices: ReturnType<typeof profileDeviceSession>
  secret: Buffer
  now: () => number
}

type LinkedDevice = ReturnType<SessionGuardOptions['linkedDevices']['deviceOf']>

// What "Qui lit ?" asks before a profile is open on the device.
const isQuiLit = (request: express.Request) =>
  (request.method === 'GET' && request.path === '/session') ||
  (request.method === 'GET' && request.path === '/profiles') ||
  (request.method === 'GET' && /^\/profiles\/\d+\/photo$/.test(request.path)) ||
  (request.method === 'GET' && /^\/households\/\d+\/photo$/.test(request.path)) ||
  (request.method === 'PUT' && request.path === '/profiles/current')

// Everything registered after this middleware requires a valid session.
// The server's admin with no profile in the household (none yet, or one made for others): /server alone, the
// device is on no household. False when the refusal is sent.
const serverOnly = (request: express.Request, response: express.Response, account: UserAccount) => {
  const open =
    (request.method === 'GET' && request.path === '/session') ||
    // « Validation en deux étapes », which /server needs first.
    request.path.startsWith('/account/two-factor') ||
    request.path.startsWith('/server/') ||
    request.path === '/plugins' ||
    request.path.startsWith('/plugins/')
  if (!open) {
    response.status(403).json({ error: 'no_household' })
    return false
  }
  response.locals.accountId = account.id
  response.locals.serverOnly = true
  return true
}

const householdHelpers = ({
  accounts,
  profiles,
  household,
  serverSettings,
  sessionOf
}: Pick<SessionGuardOptions, 'accounts' | 'profiles' | 'household' | 'serverSettings' | 'sessionOf'>) => {
  // The household a signed-in device reads in: the one it was moved to while its account has a profile there, else
  // its account's first.
  const householdOfSession = ({ account, device }: { account: UserAccount; device: UserDevice | null }) => {
    if (!accounts) return null
    const moved = device?.householdId ?? null
    if (moved !== null && accounts.profileOf(account.id, moved) !== null) return moved
    return accounts.householdOf(account.id)
  }

  // Whether the household this request reads in is set up. isSetUp() reads the household of the scope, the first one
  // here: a server whose first household was left for later still has the households a plugin made, set up from the
  // start, and a session or a young profile's device in one of them goes on as on any server.
  const readsInSetUpHousehold = (request: express.Request, linked: LinkedDevice) => {
    if (household.isSetUp()) return true
    if (!serverSettings?.householdLater()) return false
    const session = linked ? null : sessionOf(request)
    const householdId = linked
      ? profiles?.householdOf(linked.device.profileId)
      : session
        ? householdOfSession(session)
        : null
    return (
      householdId !== null &&
      householdId !== undefined &&
      householdId !== DEFAULT_ACCOUNT_ID &&
      inHousehold(householdId, () => household.isSetUp())
    )
  }

  return { householdOfSession, readsInSetUpHousehold }
}

// Before the household this request reads in is set up: the server's admin alone, for /server and the setup steps.
const answerBeforeSetup = (
  { accounts, serverSettings, sessionOf }: Pick<SessionGuardOptions, 'accounts' | 'serverSettings' | 'sessionOf'>,
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
  // « Aller à l'espace Serveur » at the setup: no household yet, the server's admin signs in for /server alone.
  if (serverSettings?.householdLater() && accounts?.any()) {
    const session = sessionOf(request)
    if (!session?.account.serverAdmin) {
      response.status(401).json({ error: 'unauthenticated' })
      return
    }
    if (serverOnly(request, response, session.account)) next()
    return
  }
  response.status(401).json({ error: 'setup_required' })
}

const requireSessionOf = (options: SessionGuardOptions): RequestHandler => {
  const { accounts, devices, profiles, sessionOf, cookieFor, linkedDevices } = options
  const { householdOfSession, readsInSetUpHousehold } = householdHelpers(options)
  return (request, response, next) => {
    const linked = linkedDevices.deviceOf(request)
    if (!readsInSetUpHousehold(request, linked)) {
      answerBeforeSetup(options, request, response, next)
      return
    }

    // A young profile's own device: that profile only, whatever its profile cookie says.
    // From here on, the request is for one household: its profile's, or its account's. Every store of one
    // household's data reads that one (household-scope.ts).
    if (linked) {
      response.locals.linkedProfileId = linked.device.profileId
      if (linked.cookie) response.append('Set-Cookie', linked.cookie)
      inHousehold(profiles?.householdOf(linked.device.profileId) ?? DEFAULT_ACCOUNT_ID, next)
      return
    }

    const session = sessionOf(request)
    const householdId = (session && householdOfSession(session)) ?? DEFAULT_ACCOUNT_ID
    if (session?.account.serverAdmin && accounts?.profileOf(session.account.id, householdId) === null) {
      if (serverOnly(request, response, session.account)) inHousehold(householdId, next)
      return
    }
    if (session) {
      response.locals.accountId = session.account.id
      // A session from before devices were kept: this device gets its row in Appareils, and a cookie naming it.
      if (!session.device && devices) response.append('Set-Cookie', cookieFor(session.account, request))
      inHousehold(householdId, next)
      return
    }

    response.status(401).json({ error: 'unauthenticated' })
  }
}

// No household: no profile, the server's admin and nothing else.
const serverOnlyLocals = (response: express.Response) => {
  response.locals.profileId = 0
  response.locals.admin = false
  response.locals.serverAdmin = true
  response.locals.profileChosen = false
}

// The profile a request is for, and whether it is chosen on this device or the device reads as nobody.
const profileOfRequest = (
  { accounts, profiles, secret }: Pick<SessionGuardOptions, 'accounts' | 'profiles' | 'secret'>,
  request: express.Request,
  linkedId: number | undefined
) => {
  const token = readProfileToken(
    readCookie(request.get('cookie'), PROFILE_COOKIE),
    secret,
    id => profiles?.lock(id)?.version ?? 0
  )
  const known = profiles?.list() ?? []
  const isGuarded = (candidate: Profile) => guardOf(candidate, accounts) !== null
  // Linked by a parent's code: the device is that profile's.
  const chosen =
    linkedId !== undefined
      ? known.find(candidate => candidate.id === linkedId)
      : token
        ? known.find(candidate => candidate.id === token.id && (token.signed || !isGuarded(candidate)))
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
    const linkedId = response.locals.linkedProfileId as number | undefined
    const { chosen, profile, locked } = profileOfRequest(options, request, linkedId)
    response.locals.profileId = profile?.id ?? 1
    response.locals.admin = locked ? false : profile ? profile.role === 'admin' : true
    // The server's admin is an account, not a role in the household: the profile opened here must be that account's,
    // so another adult opening their own profile on the same device never gets it. Without accounts (older tests),
    // the household's admin stands for it.
    response.locals.serverAdmin = locked
      ? false
      : accounts
        ? profile !== undefined && accounts.ofProfile(profile.id)?.serverAdmin === true
        : response.locals.admin
    response.locals.kind = profile?.kind ?? 'adult'
    // false: this device has not chosen yet, the app asks "Qui lit ?".
    response.locals.profileChosen = chosen !== undefined
    // Nothing but "Qui lit ?" answers: the list, the photos and the choice of a profile with its code.
    if (locked && !isQuiLit(request)) {
      response.status(403).json({ error: 'profile_locked' })
      return
    }
    // A profile opened here: it counts in the server's visits of the day and as online, as numbers only.
    if (chosen !== undefined) {
      presence.seen(chosen.id, request.get('user-agent') ?? '', now())
      serverStats?.recordVisit(chosen.id, now())
    }
    response.locals.linkedDevice = linkedId !== undefined
    // A linked device never changes profile.
    if (linkedId !== undefined && request.method === 'PUT' && request.path === '/profiles/current') {
      response.status(403).json({ error: 'linked_device' })
      return
    }
    next()
  }
}

// Who a request reads as: requireSession lets in a signed-in device or a young profile's own one, in its household;
// chooseProfile then says which profile of that household it is for.
export const sessionGuards = (options: SessionGuardOptions) => ({
  requireSession: requireSessionOf(options),
  chooseProfile: chooseProfileOf(options)
})
