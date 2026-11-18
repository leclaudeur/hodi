import express from 'express'
import type { LoginThrottle } from '../auth/login-throttle.ts'
import { hashPassword, needsRehash, verifyPassword } from '../auth/password.ts'
import { clearedProfileCookie, profileCookie, profileToken } from '../auth/session.ts'
import { currentHouseholdId } from '../db/household-scope.ts'
import type { HouseholdStore } from '../db/household-store.ts'
import type { Profile, ProfileStore } from '../db/profile-store.ts'
import type { UserAccount, UserAccountStore } from '../db/user-account-store.ts'
import { clientAddressOf } from './client-address.ts'
import { type Guard, guardOf, isAccountGuard } from './profile-guard.ts'
import type { TrustedDevices } from './trusted-devices.ts'

// « Qui lit ? »: which profile this device reads as, after what its guard asks for.

const MAX_PASSWORD_LENGTH = 256

export interface CurrentRoutesOptions {
  profiles: ProfileStore
  now: () => number
  // Signs the device's choice of a profile.
  secret: Buffer
  pinThrottle: LoginThrottle
  // The people's accounts, whose passwords open their private profiles; absent in tests without accounts.
  accounts?: UserAccountStore
  // The household's Code parental; absent in tests without it.
  household?: HouseholdStore
  // The session cookie of an account on this device: the one whose profile opens here becomes the device's.
  signIn?: (account: UserAccount, request: express.Request) => string
  // « Ne plus demander sur cet appareil ».
  trust?: TrustedDevices
}

// The device's account, when one is signed in here.
export const deviceAccountOf = (response: express.Response) => response.locals.accountId as number | undefined

// What opens a profile here, with the household's Code parental as it is now.
export const guardFor =
  ({ accounts, household }: Pick<CurrentRoutesOptions, 'accounts' | 'household'>) =>
  (profile: Profile) =>
    guardOf(profile, accounts, household?.parentalCode() != null)

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
  const { accounts, household } = options
  const passwordOk = async (account: UserAccount, password: unknown) => {
    if (typeof password !== 'string' || password.length > MAX_PASSWORD_LENGTH) return false
    if (!(await verifyPassword(password, account.passwordHash))) return false
    if (needsRehash(account.passwordHash)) accounts?.upgradePassword(account.id, await hashPassword(password))
    return true
  }
  const codeOk = async (code: unknown) => {
    const hash = household?.parentalCode()
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
    if (guard === 'code') {
      const check = () => codeOk(body?.code)
      return throttledCheck(
        options,
        { key: `code.${currentHouseholdId()}`, check, error: 'wrong_code' },
        request,
        response
      )
    }
    const check = () => passwordOk(guard, body?.password)
    return throttledCheck(options, { key: String(guard.id), check, error: 'wrong_password' }, request, response)
  }
}

export const mountCurrentRoutes = (router: express.Router, options: CurrentRoutesOptions) => {
  const { profiles, accounts, secret, signIn, trust } = options
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
    const guard = guardOfProfile(profile)
    const trusted = isAccountGuard(guard) && trust ? trust.trustedFor(request, guard) : null
    if (!trusted && !(await checkOpening(guard, request, response))) return
    // There is no device's account: whoever opens their private profile here is the one signed in, for their
    // account's pages.
    const cookies = [cookieFor(profile.id)]
    if (isAccountGuard(guard) && trust && (trusted || request.body?.trust === true))
      cookies.push(...trust.trustHere(request, guard, trusted))
    else if (isAccountGuard(guard) && accounts && signIn && guard.id !== deviceAccountOf(response))
      cookies.push(signIn(guard, request))
    response.set('Set-Cookie', cookies)
    response.json({ current: profile.id })
  })

  // The app opening again on this device: it asks « Qui lit ? » first, like a TV's streaming app.
  router.delete('/current', (_request, response) => {
    response.set('Set-Cookie', clearedProfileCookie())
    response.status(204).end()
  })
}
