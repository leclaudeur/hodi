import { randomBytes } from 'node:crypto'
import { cleanHandle } from '../handle.ts'
import express from 'express'
import type { LoginThrottle } from '../auth/login-throttle.ts'
import { NO_PASSWORD, hashPassword, needsRehash, verifyPassword } from '../auth/password.ts'
import { SecondStepTickets } from '../auth/second-step-tickets.ts'
import { clearedProfileCookie, clearedSessionCookie, profileCookie, profileToken } from '../auth/session.ts'
import type { ProfileStore } from '../db/profile-store.ts'
import type { TwoFactorStore } from '../db/two-factor-store.ts'
import { type UserAccount, type UserAccountStore, cleanEmail } from '../db/user-account-store.ts'
import type { UserDeviceStore } from '../db/user-device-store.ts'
import type { PluginRegistry } from '../plugins/registry.ts'
import type { CookieFor, accountSession } from './account-session.ts'
import { clientAddressOf } from './client-address.ts'
import { type CheckSignIn, refuseSignIn } from './sign-in-check.ts'
import { CONFIG } from '../fixed-config.ts'

const MAX_PASSWORD_LENGTH = CONFIG.passwords.maxLength

interface LoginRoutesOptions {
  accounts?: UserAccountStore
  devices?: UserDeviceStore
  profiles?: ProfileStore
  plugins?: PluginRegistry
  twoFactor?: TwoFactorStore
  throttle: LoginThrottle
  cookieFor: CookieFor
  // The accounts signed in on this device, and its cookie once one of them signs out.
  session?: Pick<ReturnType<typeof accountSession>, 'sessionOf' | 'sessionsOf' | 'cookieWithout'>
  secret: Buffer
  now: () => number
}

// Connexion: an account's e-mail and password, the app's code after them, and signing out.
export const loginRoutes = (options: LoginRoutesOptions) => {
  const router = express.Router()
  const helpers = signInHelpers(options)
  mountLoginRoute(router, options, helpers)
  mountLogoutRoute(router, options)
  mountSecondStepRoute(router, options, helpers)
  const { checkSignIn, ownProfileCookie, resetAccountPassword, secondStepTickets } = helpers
  return { router, checkSignIn, ownProfileCookie, resetAccountPassword, secondStepTickets }
}

const signInHelpers = ({
  accounts,
  devices,
  profiles,
  plugins,
  twoFactor,
  throttle,
  cookieFor,
  secret,
  now
}: LoginRoutesOptions) => {
  // The plugins' checkSignIn, at every sign-in of an existing account but the server admin's.
  // An account its plugin suspended is refused, with that plugin's own words when it has them.
  const checkSignIn: CheckSignIn = async account => {
    if (account.serverAdmin) return null
    if (account.suspendedBy) return { plugin: account.suspendedBy, message: 'signIn.suspended' }
    if (!plugins) return null
    return plugins.checkSignIn({ accountId: account.id })
  }

  // With « Validation en deux étapes » on, a sign-in also takes the app's code or a recovery code: 403
  // two_factor_required when none came (not a failure, the password was right), invalid_code counted as a wrong
  // password. false when the refusal was sent.
  const secondStepOk = (account: UserAccount, request: express.Request, response: express.Response, client: string) => {
    if (!twoFactor?.isOn(account.id)) return true
    const code: unknown = request.body?.code
    if (code === undefined || code === '') {
      response.status(403).json({ error: 'two_factor_required' })
      return false
    }
    if (twoFactor.verify(account.id, code, now())) return true
    throttle.recordFailure(now(), client)
    response.status(403).json({ error: 'invalid_code' })
    return false
  }

  // The sign-ins a plugin vouched for that wait for the app's code.
  const secondStepTickets = new SecondStepTickets()

  // The cookie that opens an account's own profile once its password was given (Connexion, a new password).
  const ownProfileCookie = (accountId: number) => {
    const profileId = accounts?.profileOf(accountId) ?? null
    if (profileId === null || !profiles) return null
    return profileCookie(profileToken(profileId, profiles.lock(profileId)?.version ?? 0, secret))
  }

  // A forgotten password may be known to someone else: every device of the account signs in again.
  // With « Validation en deux étapes » on, the device then signs in on the Connexion page, with the app's code: null.
  const resetAccountPassword = (account: UserAccount, hash: string, request: express.Request) => {
    accounts!.setPassword(account.id, hash, now())
    accounts!.revokeSessions(account.id)
    devices!.deleteAll(account.id)
    if (twoFactor?.isOn(account.id)) return null
    return cookieFor(accounts!.get(account.id)!, request)
  }

  return { checkSignIn, secondStepOk, ownProfileCookie, resetAccountPassword, secondStepTickets }
}

type SignInHelpers = ReturnType<typeof signInHelpers>

// The account an e-mail or an @identifier names; null when none has it, undefined when it cannot be either.
const accountOf = (accounts: UserAccountStore, typed: unknown) => {
  const email = typeof typed === 'string' && /.@/.test(typed) ? cleanEmail(typed) : null
  const handle = email ? null : cleanHandle(typed)
  if (!email && !handle) return undefined
  return email ? accounts.byEmail(email) : accounts.byHandle(handle!)
}

// An e-mail whose account the server's admin blocked: the person is told so, whatever password they typed.
const isBlocked = (accounts: UserAccountStore | undefined, typed: unknown) => {
  const email = cleanEmail(typed)
  return email !== null && accounts !== undefined && accounts.isBlocked(email)
}

const mountLoginRoute = (
  router: express.Router,
  { accounts, throttle, cookieFor, now }: LoginRoutesOptions,
  { checkSignIn, secondStepOk, ownProfileCookie }: SignInHelpers
) => {
  // Compared with when no account has the e-mail typed, so that a wrong address takes as long as a wrong password.
  let decoyHash: Promise<string> | null = null

  // Everyone signs in with their own account: its e-mail or its @identifier, and its password.
  router.post('/login', async (request, response) => {
    const password: unknown = request.body?.password
    const typedEmail: unknown = request.body?.email

    if (typeof password !== 'string' || password.length === 0 || password.length > MAX_PASSWORD_LENGTH) {
      response.status(400).json({ error: 'invalid_request' })
      return
    }

    const client = clientAddressOf(request)
    const decision = throttle.check(now(), client)

    if (!decision.allowed) {
      response.set('Retry-After', String(decision.retryAfterSeconds))
      response.status(429).json({ error: 'too_many_attempts', retryAfterSeconds: decision.retryAfterSeconds })
      return
    }

    const account = accounts ? accountOf(accounts, typedEmail) : undefined
    if (account === undefined) {
      response.status(400).json({ error: 'invalid_request' })
      return
    }
    decoyHash ??= hashPassword(randomBytes(16).toString('hex'))
    // An account with no password yet takes as long as any other.
    const hash = account && account.passwordHash !== NO_PASSWORD ? account.passwordHash : await decoyHash
    const valid = (await verifyPassword(password, hash)) && account?.passwordHash !== NO_PASSWORD
    if (!account && isBlocked(accounts, typedEmail)) {
      // Counted as a wrong password: nobody tries addresses at full speed to learn who was blocked.
      throttle.recordFailure(now(), client)
      response.status(403).json({ error: 'blocked' })
      return
    }
    if (!account || !valid) {
      throttle.recordFailure(now(), client)
      response.status(401).json({ error: 'invalid_credentials' })
      return
    }
    const refusal = await checkSignIn(account)
    if (refusal) {
      refuseSignIn(response, refusal)
      return
    }
    // « Validation en deux étapes »: the password was right, the app's code (or a recovery code) comes next.
    if (!secondStepOk(account, request, response, client)) return
    if (needsRehash(account.passwordHash)) accounts?.upgradePassword(account.id, await hashPassword(password))
    const cookies = [cookieFor(account, request)]
    // Its own profile opens at once: the password proved who reads, a PIN of its own included.
    const own = ownProfileCookie(account.id)
    if (own) cookies.push(own)
    response.set('Set-Cookie', cookies)
    response.status(204).end()
  })
}

const mountLogoutRoute = (router: express.Router, { devices, session }: LoginRoutesOptions) => {
  // « Se déconnecter »: the account whose profile is open leaves this device; the others signed in here stay, and
  // « Qui lit ? » opens again.
  router.post('/logout', (request, response) => {
    const leaving = session?.sessionOf(request) ?? null
    if (leaving?.device) devices?.delete(leaving.account.id, leaving.device.id)
    const cookie =
      leaving && session ? session.cookieWithout(leaving.account.id, request).cookie : clearedSessionCookie()
    response.set('Set-Cookie', [cookie, clearedProfileCookie()])
    response.status(204).end()
  })
}

const mountSecondStepRoute = (
  router: express.Router,
  { accounts, twoFactor, throttle, cookieFor, now }: LoginRoutesOptions,
  { checkSignIn, ownProfileCookie, secondStepTickets }: SignInHelpers
) => {
  // The app's code after a plugin's sign-in, typed in Hodi's dialog: the ticket the plugin's answer carried stands for
  // the first step. A wrong code counts as a wrong password at Connexion.
  if (accounts && twoFactor)
    router.post('/login/second-step', async (request, response) => {
      const client = clientAddressOf(request)
      const decision = throttle.check(now(), client)
      if (!decision.allowed) {
        response.set('Retry-After', String(decision.retryAfterSeconds))
        response.status(429).json({ error: 'too_many_attempts', retryAfterSeconds: decision.retryAfterSeconds })
        return
      }
      const ticket: unknown = request.body?.ticket
      const accountId = secondStepTickets.accountOf(ticket, now())
      const account = accountId === null ? undefined : accounts.get(accountId)
      if (typeof ticket !== 'string' || !account || account.serverAdmin || !twoFactor.isOn(account.id)) {
        response.status(403).json({ error: 'second_step_expired' })
        return
      }
      if (!twoFactor.verify(account.id, request.body?.code, now())) {
        throttle.recordFailure(now(), client)
        secondStepTickets.failed(ticket)
        response.status(403).json({ error: 'invalid_code' })
        return
      }
      secondStepTickets.use(ticket)
      // A plugin may have suspended the account since the first step: asked again, as at Connexion.
      const refusal = await checkSignIn(account)
      if (refusal) {
        refuseSignIn(response, refusal)
        return
      }
      const cookies = [cookieFor(account, request)]
      const own = ownProfileCookie(account.id)
      if (own) cookies.push(own)
      response.set('Set-Cookie', cookies)
      response.status(204).end()
    })
}
