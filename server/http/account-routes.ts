import express from 'express'
import { rateLimit } from 'express-rate-limit'
import type { LoginThrottle } from '../auth/login-throttle.ts'
import { hashPassword } from '../auth/password.ts'
import { type AccountDataStore, deletionPlan } from '../db/account-data.ts'
import { currentHouseholdId } from '../db/household-scope.ts'
import type { HouseholdStore } from '../db/household-store.ts'
import type { ProfileStore } from '../db/profile-store.ts'
import { type UserAccount, type UserAccountStore, cleanEmail } from '../db/user-account-store.ts'
import type { UserDevice, UserDeviceStore } from '../db/user-device-store.ts'
import { isPassword } from './household-input.ts'
import { profileIdOf } from './profile-routes.ts'
import type { HandleStore } from '../db/handle-store.ts'
import type { TwoFactorStore } from '../db/two-factor-store.ts'
import { RECENT_SIGN_IN_MS, proofCheck } from './proof.ts'
import { mountDeleteRoute } from './account-delete-route.ts'
import { mountLeaveRoute } from './account-leave-route.ts'
import { mountLockRoutes } from './account-lock-routes.ts'
import { mountRegionRoutes } from './account-region-routes.ts'
import { type AccountAiOptions, accountAiView, mountAiRoutes } from './account-ai-routes.ts'

// The person's own account, after the session and profile checks: Réglages > Compte et données.

// « Télécharger une copie »: how many an account may ask in a minute.
export const COPIES_PER_MINUTE = 5

export interface AccountRoutesOptions extends AccountAiOptions {
  data: AccountDataStore
  accounts: UserAccountStore
  devices: UserDeviceStore
  profiles?: ProfileStore
  household: HouseholdStore
  // The install's time zone, for an account and a household with none.
  defaultTimeZone?: string
  // The account and device a request is signed in with.
  sessionOf: (request: express.Request) => { account: UserAccount; device: UserDevice | null } | null
  cookieForDevice: (account: UserAccount, deviceId: number, request: express.Request) => string
  // The device's session cookie without that account: the others signed in here stay.
  cookieWithout?: (accountId: number, request: express.Request) => { cookie: string }
  // The signed choice of a profile on this device, which a new password changes.
  profileCookieFor?: (profileId: number) => string
  // Wrong passwords, as on the Connexion page.
  throttle: LoginThrottle
  now: () => number
  // What else goes with a deleted profile (its sources, its devices' alerts), before it goes.
  onDeleteProfile?: (profileId: number) => void
  // The household went with its last adult's account: the install waits for its first-run screens again.
  onHouseholdGone?: () => void
  // The account is gone: the plugins forget it.
  onAccountDeleted?: (accountId: number) => void
  // What each plugin keeps of the person, by plugin id, for the copy.
  // « Validation en deux étapes »; absent in tests without it.
  twoFactor?: TwoFactorStore
  // The @identifier's next change, for Mon compte.
  handles?: HandleStore
  pluginCopies?: (who: {
    accountId: number
    profileId: number | null
    householdId: number
  }) => Promise<Record<string, unknown>>
}

export const accountRoutes = (options: AccountRoutesOptions) => {
  const router = express.Router()
  const helpers = accountHelpers(options)
  // A teen or a child sees its account; its parents change it (its password, its region, its AI, its deletion). It
  // may still sign out one of its own devices, a lost phone.
  router.use((request, response, next) => {
    const ownDevice = request.method === 'DELETE' && request.path.startsWith('/devices/')
    const session = request.method === 'GET' || ownDevice ? null : options.sessionOf(request)
    if (session && options.accounts.young.isYoung(session.account.id))
      response.status(403).json({ error: 'parents_only' })
    else next()
  })
  router.get('/', (request, response) => {
    const session = helpers.sessionOrRefuse(request, response)
    if (session) response.json(helpers.view(session.account, session.device))
  })
  mountTwoFactorRoutes(router, options, helpers)
  mountLockRoutes(router, options, helpers)
  mountRegionRoutes(router, options, helpers)
  mountAiRoutes(router, options, helpers)
  mountCredentialRoutes(router, options, helpers)
  mountCopyRoute(router, options, helpers)
  mountDeleteRoute(router, options, helpers)
  mountLeaveRoute(router, options, helpers)
  return router
}

const accountHelpers = ({
  accounts,
  devices,
  profiles,
  household,
  sessionOf,
  throttle,
  now,
  twoFactor,
  data,
  defaultTimeZone = 'UTC',
  accountAi,
  providers,
  handles
}: AccountRoutesOptions) => {
  // All of it is the signed-in account's own, from its own profile: a child's profile open on a parent's
  // device sees none of it.
  const sessionOrRefuse = (request: express.Request, response: express.Response) => {
    const session = sessionOf(request)
    const own = session ? accounts.profileOf(session.account.id) : null
    if (!session || (profiles && own !== null && own !== profileIdOf(response))) {
      response.status(403).json({ error: 'account_only' })
      return null
    }
    return session
  }

  // An account with no password of its own proves who changes it by having signed in on this device a moment ago,
  // through its plugin (« Se connecter avec Google »).
  const recentlySignedIn = (device: UserDevice | null) =>
    device !== null && now() - device.createdAt <= RECENT_SIGN_IN_MS

  // The account's password, typed again before a change; false sends the refusal.
  const checkProof = proofCheck({ throttle, now, sessionOf, twoFactor })

  const plan = (account: UserAccount) =>
    profiles ? deletionPlan(account, accounts, profiles, household.get().name) : null

  const view = (account: UserAccount, device: UserDevice | null) => {
    const going = plan(account)
    return {
      email: account.email,
      young: accounts.young.isYoung(account.id),
      handle: account.handle,
      // Before then, « Modifier » keeps the identifier as it is.
      handleChangeableFrom: handles?.changeableFrom(account.id, now()) ?? null,
      passwordChangedAt: account.passwordChangedAt,
      // No password of its own: its changes need a sign-in on this device in the last 5 minutes instead.
      loginOnly: !account.hasPassword,
      recentSignIn: recentlySignedIn(device),
      privateProfile: account.privateProfile,
      // Its own, else the household's, as the account's days run in it.
      timeZone: account.timeZone ?? household.get().timeZone ?? defaultTimeZone,
      country: account.country,
      ...accountAiView({ accountAi, providers }, account),
      devices: devices.list(account.id).map(({ id, userAgent, lastSeenAt, trusted }) => ({
        id,
        userAgent,
        lastSeenAt,
        trusted,
        current: id === device?.id
      })),
      // What "Supprimer ton compte" deletes, for its confirmation.
      deletion: going && {
        householdGoes: going.householdGoes,
        household: going.household,
        others: going.profiles.slice(1).map(profile => profile.name),
        // Who becomes the household's admin when the person leaves or goes.
        heir: going.heir?.name ?? null,
        // The person reads in this household: an account with no profile here has nothing to leave.
        member: going.profiles.length > 0,
        // The person runs this household: leaving hands that over to the heir.
        admin: going.profiles[0] !== undefined && profiles?.get(going.profiles[0].id)?.role === 'admin'
      },
      // In no household: what it read and earned, its own wherever it reads; in one, Réglages › Statistiques shows it.
      stats: going && going.profiles.length > 0 ? null : data.stats(account.id),
      // « Validation en deux étapes »: the server's admin must keep it on.
      ...(twoFactor ? { twoFactor: { ...twoFactor.status(account.id), required: account.serverAdmin } } : {})
    }
  }

  return { sessionOrRefuse, recentlySignedIn, checkProof, plan, view }
}

export type AccountHelpers = ReturnType<typeof accountHelpers>

const mountTwoFactorRoutes = (
  router: express.Router,
  { now, twoFactor }: AccountRoutesOptions,
  { sessionOrRefuse, recentlySignedIn, checkProof }: AccountHelpers
) => {
  if (!twoFactor) return
  // « Activer »: a new secret for the app, its QR's otpauth link and its text. With the password, or right after a
  // sign-in on this device (the setup's « Protège le compte »): someone who took a session cannot tie the account
  // to their own phone.
  router.post('/two-factor', async (request, response) => {
    const session = sessionOrRefuse(request, response)
    if (!session) return
    if (twoFactor.isOn(session.account.id)) {
      response.status(409).json({ error: 'already_on' })
      return
    }
    if (!recentlySignedIn(session.device) && !(await checkProof(session.account, request, response))) return
    response.json(twoFactor.start(session.account.id, session.account.email ?? `@${session.account.handle}`, now()))
  })

  // The app's first code: on from now, and the recovery codes, shown this once.
  router.put('/two-factor', (request, response) => {
    const session = sessionOrRefuse(request, response)
    if (!session) return
    const recoveryCodes = twoFactor.confirm(session.account.id, request.body?.code, now())
    if (!recoveryCodes) {
      response.status(403).json({ error: 'invalid_code' })
      return
    }
    response.json({ recoveryCodes })
  })

  // « Désactiver », with the password and the app's code. Never for the server's admin.
  router.delete('/two-factor', async (request, response) => {
    const session = sessionOrRefuse(request, response)
    if (!session) return
    if (session.account.serverAdmin) {
      response.status(403).json({ error: 'required' })
      return
    }
    if (!(await checkProof(session.account, request, response))) return
    twoFactor.stop(session.account.id)
    response.status(204).end()
  })

  // « Nouveaux codes de secours »: the old ones stop working.
  router.post('/two-factor/recovery-codes', async (request, response) => {
    const session = sessionOrRefuse(request, response)
    if (!session) return
    if (!twoFactor.isOn(session.account.id)) {
      response.status(409).json({ error: 'off' })
      return
    }
    if (!(await checkProof(session.account, request, response))) return
    response.json({ recoveryCodes: twoFactor.newRecoveryCodes(session.account.id) })
  })
}

const mountCredentialRoutes = (
  router: express.Router,
  { accounts, devices, cookieForDevice, profileCookieFor, now }: AccountRoutesOptions,
  { sessionOrRefuse, checkProof, view }: AccountHelpers
) => {
  // "Changer d'e-mail". Without a mail server, the address changes once the password is right.
  router.put('/email', async (request, response) => {
    const session = sessionOrRefuse(request, response)
    if (!session) return
    const email = cleanEmail(request.body?.email)
    if (!email) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    if (!(await checkProof(session.account, request, response))) return
    const owner = accounts.byEmail(email)
    if (owner && owner.id !== session.account.id) {
      response.status(409).json({ error: 'email_taken' })
      return
    }
    accounts.setEmail(session.account.id, email)
    response.json(view(accounts.get(session.account.id)!, session.device))
  })

  // "Changer le mot de passe": every other device of the account signs in again, this one goes on.
  router.put('/password', async (request, response) => {
    const session = sessionOrRefuse(request, response)
    if (!session) return
    const { current, next } = (request.body ?? {}) as { current?: unknown; next?: unknown }
    if (!isPassword(next)) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    if (!(await checkProof(session.account, request, response, current))) return
    const id = session.account.id
    accounts.setPassword(id, await hashPassword(next), now())
    accounts.revokeSessions(id)
    const account = accounts.get(id)!
    let device = session.device
    if (device) devices.deleteOthers(id, device.id)
    else device = devices.create(id, request.get('user-agent') ?? '', now())
    // The new password proved who reads here: its profile stays open on this device.
    const own = accounts.profileOf(id)
    const cookies = [cookieForDevice(account, device.id, request)]
    if (own !== null && profileCookieFor) cookies.push(profileCookieFor(own))
    response.set('Set-Cookie', cookies)
    response.json(view(account, device))
  })

  // "Déconnecter": another device of the account. This one signs out from the menu.
  router.delete('/devices/:id', (request, response) => {
    const session = sessionOrRefuse(request, response)
    if (!session) return
    const id = Number(request.params.id)
    if (!Number.isInteger(id) || id === session.device?.id || !devices.delete(session.account.id, id)) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    response.json(view(session.account, session.device))
  })
}

const mountCopyRoute = (
  router: express.Router,
  { data, accounts, sessionOf, now, pluginCopies }: AccountRoutesOptions,
  { sessionOrRefuse }: AccountHelpers
) => {
  // "Télécharger une copie": a JSON file, straight to the browser's downloads.
  // One copy at a time for an account, and a few a minute: each asks every plugin, and asking in a row must not keep
  // their threads busy for everyone else.
  const copying = new Set<number>()
  const copyLimit = rateLimit({
    windowMs: 60_000,
    limit: COPIES_PER_MINUTE,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: request => `account:${sessionOf(request)?.account.id ?? 'none'}`,
    validate: { xForwardedForHeader: false },
    handler: (_request, response) => {
      response.status(429).json({ error: 'too_many_requests' })
    }
  })
  router.get('/copy', copyLimit, async (request, response) => {
    const session = sessionOrRefuse(request, response)
    if (!session) return
    if (copying.has(session.account.id)) {
      response.status(429).json({ error: 'busy' })
      return
    }
    copying.add(session.account.id)
    try {
      await sendCopy(session, response)
    } finally {
      copying.delete(session.account.id)
    }
  })
  const sendCopy = async (session: { account: UserAccount; device: UserDevice | null }, response: express.Response) => {
    const profileId = accounts.profileOf(session.account.id)
    const copy = {
      ...data.copy(session.account, profileId, now()),
      // What the plugins keep of the person, each in its own part.
      ...(pluginCopies
        ? {
            plugins: await pluginCopies({
              accountId: session.account.id,
              profileId,
              householdId: currentHouseholdId()
            })
          }
        : {})
    }
    const day = new Date(now()).toISOString().slice(0, 10)
    response.set('Content-Disposition', `attachment; filename="hodi-${day}.json"`)
    response.set('Cache-Control', 'no-store')
    response.type('application/json').send(JSON.stringify(copy, null, 2))
  }
}
