import type express from 'express'
import type { LoginThrottle } from '../auth/login-throttle.ts'
import { randomBytes } from 'node:crypto'
import { hashPassword, verifyPassword } from '../auth/password.ts'
import { profileCookie, profileToken } from '../auth/session.ts'
import type { HouseholdStore } from '../db/household-store.ts'
import { currentHouseholdId } from '../db/household-scope.ts'
import { MAX_PROFILES, type Profile, type ProfileStore, isYoung } from '../db/profile-store.ts'
import { type SignInCode, type SignInCodeStore, signInCodeOf } from '../db/sign-in-code-store.ts'
import { type UserAccount, type UserAccountStore, cleanEmail } from '../db/user-account-store.ts'
import type { CookieFor } from './account-session.ts'
import { clientAddressOf } from './client-address.ts'
import { type CheckSignIn, refuseSignIn } from './sign-in-check.ts'
import { isPassword } from './household-input.ts'

const MAX_PASSWORD_LENGTH = 256

export interface CodeJoinOptions {
  codes: SignInCodeStore
  accounts: UserAccountStore
  profiles: ProfileStore
  household: HouseholdStore
  // Shared with the Connexion page: a wrong code counts as a wrong password from the same device.
  throttle: LoginThrottle
  secret: Buffer
  now: () => number
  cookieFor: CookieFor
  // A young profile's own device: its row and its session cookie; absent without the store.
  linkDevice?: (profileId: number, request: express.Request) => string
  // "Mot de passe oublié": the new password, every device of the account signed out, and this one's cookie; null when
  // this device signs in on the Connexion page instead (« Validation en deux étapes »).
  resetPassword?: (account: UserAccount, passwordHash: string, request: express.Request) => string | null
  // What a new profile starts with, as one added in Réglages > Profils.
  onProfileCreated?: (profileId: number) => void
  // The plugins' say on an existing account signing in (« J'ai déjà un compte », a new password).
  checkSignIn?: CheckSignIn
  // false for an account with « Validation en deux étapes » on: what the code does is done, but this device signs in
  // on the Connexion page, with the app's code.
  signsInHere?: (account: UserAccount) => boolean
}

export type ResolvedJoinOptions = CodeJoinOptions & Required<Pick<CodeJoinOptions, 'checkSignIn' | 'signsInHere'>>

// What "Rejoins <foyer>" and "Ton profil t'attend" show of a profile: no photo, which only a session may load.
const publicProfile = ({ id, name, color, kind, avatar }: Profile) => ({ id, name, color, kind, avatar })

// Whether a household's admin may give a code that sets a new password for this account: never the server's admin's
// (that would hand the whole server to the household's admin), nor an account that also reads in another household,
// which this household's admin has no say over. Those use « Mot de passe oublié » by e-mail, or the server's admin.
export const resettableByCode = (accounts: UserAccountStore, account: UserAccount) =>
  !account.serverAdmin &&
  accounts.profilesOf(account.id).every(({ householdId }) => householdId === currentHouseholdId())

// The cookies of a device that now reads as this profile, after its session cookie.
export const withProfileCookie = (
  { profiles, secret }: Pick<CodeJoinOptions, 'profiles' | 'secret'>,
  sessionCookie: string,
  profileId: number
) => [sessionCookie, profileCookie(profileToken(profileId, profiles.lock(profileId)?.version ?? 0, secret))]

export const codeHelpers = ({
  codes,
  accounts,
  profiles,
  household,
  throttle,
  now,
  linkDevice,
  resetPassword
}: CodeJoinOptions) => {
  // Checked again when the code is used: the account may have become the server's admin since the code was made.
  const resettable = (profileId: number) => {
    const account = accounts.ofProfile(profileId)
    return account !== null && resettableByCode(accounts, account)
  }

  // A profile's code holds while it still waits for it: an adult without an account, any young profile, or, for a
  // reset, an adult who has one.
  const waitsForCode = (found: SignInCode, target: Profile) => {
    if (isYoung(target)) return linkDevice !== undefined
    if (found.reset) return target.hasAccount && resetPassword !== undefined && resettable(target.id)
    return !target.hasAccount
  }

  // The code's use, while it has one: an invitation, or a profile still without its person. Else the refusal is
  // sent and the failure counted.
  const validCode = (request: express.Request, response: express.Response) => {
    const client = clientAddressOf(request)
    const decision = throttle.check(now(), client)
    if (!decision.allowed) {
      response.set('Retry-After', String(decision.retryAfterSeconds))
      response.status(429).json({ error: 'too_many_attempts', retryAfterSeconds: decision.retryAfterSeconds })
      return null
    }
    const code = signInCodeOf(request.body?.code)
    const found = code && household.isSetUp() ? codes.peek(code, now()) : null
    const target = found?.profileId ? profiles.get(found.profileId) : null
    const waiting = target && waitsForCode(found!, target)
    if (!found || (found.profileId !== null && !waiting)) {
      throttle.recordFailure(now(), client)
      response.status(403).json({ error: 'invalid_code' })
      return null
    }
    return { code: code!, found, target }
  }

  const describe = ({ profileId, createdBy, reset }: SignInCode) => {
    const name = household.get().name
    if (profileId !== null) {
      const profile = profiles.get(profileId)!
      const kind = isYoung(profile) ? 'device' : reset ? 'reset' : 'profile'
      return { kind, household: name, profile: publicProfile(profile) }
    }
    const by = createdBy === null ? null : profiles.get(createdBy)
    return {
      kind: 'invite',
      household: name,
      invitedBy: by ? publicProfile(by) : null,
      full: profiles.list().length >= MAX_PROFILES
    }
  }

  return { validCode, describe }
}

export type CodeHelpers = ReturnType<typeof codeHelpers>
export type ValidCode = NonNullable<ReturnType<CodeHelpers['validCode']>>

// "Rejoins <foyer>": what the request asks for, or null when it is malformed.
export const joinRequestOf = (body: Record<string, unknown>) => {
  const existing = body.existing === true
  const email = cleanEmail(body.email)
  const draft = (body.profile ?? {}) as { name?: unknown; color?: unknown }
  const passwordSent =
    typeof body.password === 'string' && body.password.length > 0 && body.password.length <= MAX_PASSWORD_LENGTH
  if (!email || (existing ? !passwordSent : !isPassword(body.password) || body.ageConfirmed !== true)) return null
  return { existing, email, password: body.password as string, draft }
}

type JoinRequest = NonNullable<ReturnType<typeof joinRequestOf>>

// « J'ai déjà un compte »: the account its e-mail and password open, or null when the refusal is sent.
export const existingAccountOf = async (
  { accounts, throttle, now, checkSignIn }: ResolvedJoinOptions,
  decoyHash: () => Promise<string>,
  { email, password }: JoinRequest,
  request: express.Request,
  response: express.Response
) => {
  // As a login: a wrong address takes as long as a wrong password, and counts as one.
  const known = accounts.byEmail(email)
  const decoy = decoyHash()
  const right = await verifyPassword(password, known?.passwordHash ?? (await decoy))
  if (!known || !right) {
    throttle.recordFailure(now(), clientAddressOf(request))
    response.status(401).json({ error: 'invalid_credentials' })
    return null
  }
  if (accounts.profileOf(known.id) !== null) {
    response.status(409).json({ error: 'already_member' })
    return null
  }
  const refusal = await checkSignIn(known)
  if (refusal) {
    refuseSignIn(response, refusal)
    return null
  }
  return known
}

// Compared with when no account has the e-mail typed in « J'ai déjà un compte ».
export const decoyHashOnce = () => {
  let decoyHash: Promise<string> | null = null
  return () => (decoyHash ??= hashPassword(randomBytes(16).toString('hex')))
}
