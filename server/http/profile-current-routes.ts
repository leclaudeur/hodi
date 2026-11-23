import express from 'express'
import type { LoginThrottle } from '../auth/login-throttle.ts'
import { hashPassword, needsRehash, verifyPassword } from '../auth/password.ts'
import { clearedProfileCookie, profileCookie, profileToken } from '../auth/session.ts'
import { type Profile, type ProfileStore, isYoung } from '../db/profile-store.ts'
import type { UserAccount, UserAccountStore } from '../db/user-account-store.ts'
import { clientAddressOf } from './client-address.ts'
import { type Guard, guardOf, isAccountGuard, isCodeGuard } from './profile-guard.ts'
import type { TrustedDevices } from './trusted-devices.ts'
import { CONFIG } from '../fixed-config.ts'

// « Qui lit ? »: which profile this device reads as, after what its guard asks for.

const MAX_PASSWORD_LENGTH = CONFIG.passwords.maxLength

export interface CurrentRoutesOptions {
  profiles: ProfileStore
  now: () => number
  // Signs the device's choice of a profile.
  secret: Buffer
  pinThrottle: LoginThrottle
  // The people's accounts, whose passwords open their private profiles; absent in tests without accounts.
  accounts?: UserAccountStore
  // The accounts signed in on this device: only their profiles open here, with their household's young ones.
  signedInHere?: (request: express.Request) => number[]
  // « Ne plus demander sur cet appareil ».
  trust?: TrustedDevices
  // A teen or a child reads on this device, or did (youngHereOf): the adults' Codes parentaux are asked here.
  youngHere?: (request: express.Request) => boolean
}

// « Qui lit ? » on this device: the profiles of the accounts signed in here, and every young profile.
export const isHere = (
  { accounts, signedInHere }: Pick<CurrentRoutesOptions, 'accounts' | 'signedInHere'>,
  profile: Profile,
  request: express.Request
) => {
  if (isYoung(profile) || !accounts || !signedInHere) return true
  const owner = profile.hasAccount ? accounts.ofProfile(profile.id) : null
  return owner !== null && signedInHere(request).includes(owner.id)
}

// The device's account, when one is signed in here.
export const deviceAccountOf = (response: express.Response) => response.locals.accountId as number | undefined

// What opens a profile on the device that sent the request, with the adults' codes as they are now.
export const guardFor =
  ({ accounts, youngHere }: Pick<CurrentRoutesOptions, 'accounts' | 'youngHere'>) =>
  (profile: Profile, request: express.Request) =>
    guardOf(profile, accounts, youngHere?.(request) ?? false)

// Wrong passwords and codes count per account (or household) and per device: a child guessing on its tablet blocks
// only that one there, never the parents' own devices. All devices together stop far later, which still caps a guess
// spread over several devices. true when the secret is right; else the refusal is sent.
const throttledCheck = async (
  { pinThrottle, now }: Pick<CurrentRoutesOptions, 'pinThrottle' | 'now'>,
  { key, check, error }: { key: string; check: () => Promise<boolean>; error: string },
  request: express.Request,
  response: express.Response
) => {
  const client = `${key}|${clientAddressOf(request)}`
  const decision = pinThrottle.check(now(), client)
  if (!decision.allowed) {
    response.set('Retry-After', String(decision.retryAfterSeconds))
    response.status(429).json({ error: 'too_many_attempts', retryAfterSeconds: decision.retryAfterSeconds })
    return false
  }
  if (await check()) return true
  pinThrottle.recordFailure(now(), client)
  response.status(403).json({ error })
  return false
}

const openingCheck = (options: CurrentRoutesOptions) => {
  const { accounts } = options
  const passwordOk = async (account: UserAccount, password: unknown) => {
    if (typeof password !== 'string' || password.length > MAX_PASSWORD_LENGTH) return false
    if (!(await verifyPassword(password, account.passwordHash))) return false
    if (needsRehash(account.passwordHash)) accounts?.upgradePassword(account.id, await hashPassword(password))
    return true
  }
  const codeOk = async (parent: UserAccount, code: unknown) => {
    const hash = parent.parentalCode
    return !hash || (typeof code === 'string' && /^\d{6}$/.test(code) && (await verifyPassword(code, hash)))
  }

  // true when what the guard asks for is right, or there is nothing to give; else the refusal is sent.
  return async (guard: Guard, request: express.Request, response: express.Response) => {
    if (guard === null) return true
    if (guard === 'no_account') {
      response.status(403).json({ error: 'no_account' })
      return false
    }
    const body = request.body as { password?: unknown; code?: unknown } | undefined
    // A forgotten Code parental: the parent's own password opens their profile instead.
    if (isCodeGuard(guard) && body?.password === undefined) {
      const check = () => codeOk(guard.codeOf, body?.code)
      return throttledCheck(options, { key: `code.${guard.codeOf.id}`, check, error: 'wrong_code' }, request, response)
    }
    const account = isCodeGuard(guard) ? guard.codeOf : guard
    const check = () => passwordOk(account, body?.password)
    return throttledCheck(options, { key: String(account.id), check, error: 'wrong_password' }, request, response)
  }
}

export const mountCurrentRoutes = (router: express.Router, options: CurrentRoutesOptions) => {
  const { profiles, secret, trust } = options
  const guardOfProfile = guardFor(options)
  const checkOpening = openingCheck(options)
  const cookieFor = (id: number) => profileCookie(profileToken(id, profiles.lock(id)?.version ?? 0, secret))

  // This device now reads as that profile, after the password or code its guard asks for, if any.
  router.put('/current', async (request, response) => {
    const id: unknown = request.body?.id
    const profile = typeof id === 'number' ? profiles.get(id) : null
    if (!profile) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    // Another adult's profile opens on a device once its account signs in there (« Ajouter »).
    if (!isHere(options, profile, request)) {
      response.status(403).json({ error: 'not_signed_in' })
      return
    }
    const guard = guardOfProfile(profile, request)
    const trusted = isAccountGuard(guard) && trust ? trust.trustedFor(request, guard) : null
    if (!trusted && !(await checkOpening(guard, request, response))) return
    if (isAccountGuard(guard) && request.body?.trust === true) trust?.trustHere(request, guard)
    response.set('Set-Cookie', cookieFor(profile.id))
    response.json({ current: profile.id })
  })

  // The app opening again on this device: it asks « Qui lit ? » first, like a TV's streaming app.
  router.delete('/current', (_request, response) => {
    response.set('Set-Cookie', clearedProfileCookie())
    response.status(204).end()
  })
}
