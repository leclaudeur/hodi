import type express from 'express'
import type { LoginThrottle } from '../auth/login-throttle.ts'
import { verifyPassword } from '../auth/password.ts'
import type { UserAccount, UserAccountStore } from '../db/user-account-store.ts'
import type { TwoFactorStore } from '../db/two-factor-store.ts'
import type { UserDevice } from '../db/user-device-store.ts'
import { clientAddressOf } from './client-address.ts'
import { profileIdOf } from './profile-routes.ts'

// The moments that cannot be undone ask the person for their own password first, whatever session the device holds:
// deleting an account or another adult's profile, a new password for another adult, handing over the admin role,
// the server's plugins, deleting in Serveur › Comptes and Foyers, a copy of the server. Someone who finds a device
// left open, or who took its cookie, cannot do any of it.

const MAX_PASSWORD_LENGTH = 256

// How long after a sign-in an account without a password of its own (« Se connecter avec Google ») may make such a
// change: having just signed in on this device is its proof.
export const RECENT_SIGN_IN_MS = 5 * 60 * 1000

export type Session = { account: UserAccount; device: UserDevice | null }

// true when the account's proof is right; else the refusal is sent: 403 invalid_password, 403 sign_in_again for an
// account without a password that signed in too long ago, 429 after too many wrong ones.
export type CheckProof = (
  account: UserAccount,
  request: express.Request,
  response: express.Response,
  // Its password, when the route reads it from elsewhere than the body's password.
  password?: unknown,
  // Its app's code, likewise, instead of the body's code.
  code?: unknown
) => Promise<boolean>

export const proofCheck = ({
  throttle,
  now,
  sessionOf,
  twoFactor
}: {
  // Wrong passwords count as on the Connexion page, from the same device.
  throttle: LoginThrottle
  now: () => number
  sessionOf: (request: express.Request) => Session | null
  // With « Validation en deux étapes » on, the app's code (or a recovery code) comes with the password.
  twoFactor?: TwoFactorStore
}): CheckProof => {
  const passwordProof: CheckProof = async (
    account,
    request,
    response,
    password = (request.body as { password?: unknown } | null)?.password
  ) => {
    if (!account.hasPassword) {
      const session = sessionOf(request)
      const device = session?.account.id === account.id ? session.device : null
      if (device && now() - device.createdAt <= RECENT_SIGN_IN_MS) return true
      response.status(403).json({ error: 'sign_in_again' })
      return false
    }
    // None typed: nothing was guessed, so nothing counts against the device.
    if (typeof password !== 'string' || password.length === 0) {
      response.status(403).json({ error: 'invalid_password' })
      return false
    }
    const client = clientAddressOf(request)
    const decision = throttle.check(now(), client)
    if (!decision.allowed) {
      response.set('Retry-After', String(decision.retryAfterSeconds))
      response.status(429).json({ error: 'too_many_attempts', retryAfterSeconds: decision.retryAfterSeconds })
      return false
    }
    if (password.length <= MAX_PASSWORD_LENGTH && (await verifyPassword(password, account.passwordHash))) {
      return true
    }
    throttle.recordFailure(now(), client)
    // Not 401: this device's session is fine, only the password typed is wrong.
    response.status(403).json({ error: 'invalid_password' })
    return false
  }
  return async (account, request, response, password, code = (request.body as { code?: unknown } | null)?.code) => {
    if (!(await passwordProof(account, request, response, password))) return false
    if (!twoFactor?.isOn(account.id)) return true
    if (twoFactor.verify(account.id, code, now())) return true
    // A wrong code counts as a wrong password: the password was right, so this is the last thing between a guess and
    // the account.
    throttle.recordFailure(now(), clientAddressOf(request))
    response.status(403).json({ error: 'invalid_code' })
    return false
  }
}

// Whose proof an action asks for: the account of the profile open on this device, since every adult profile asks for
// its own password when it opens; with no household, the server admin's session itself.
export const accountAsking = (response: express.Response, accounts: UserAccountStore) =>
  response.locals.serverOnly === true
    ? typeof response.locals.accountId === 'number'
      ? accounts.get(response.locals.accountId)
      : null
    : accounts.ofProfile(profileIdOf(response))

// The proof of the account asking, or the refusal sent: 403 account_only when no account reads here (an install from
// before accounts, a profile open without one).
export const askingWithProof = async (
  check: CheckProof,
  accounts: UserAccountStore,
  request: express.Request,
  response: express.Response
) => {
  const account = accountAsking(response, accounts)
  if (!account) {
    response.status(403).json({ error: 'account_only' })
    return null
  }
  return (await check(account, request, response)) ? account : null
}
