import type express from 'express'
import type { LoginThrottle } from '../auth/login-throttle.ts'
import { profileCookie, profileToken } from '../auth/session.ts'
import type { InstallStore } from '../db/install-store.ts'
import { type Profile, type ProfileStore, isYoung } from '../db/profile-store.ts'
import { type SignInCode, type SignInCodeStore, signInCodeOf } from '../db/sign-in-code-store.ts'
import { type UserAccount, type UserAccountStore, cleanEmail } from '../db/user-account-store.ts'
import type { CookieFor } from './account-session.ts'
import { clientAddressOf } from './client-address.ts'
import type { CheckSignIn } from './sign-in-check.ts'
import { isPassword } from './household-input.ts'

export interface CodeJoinOptions {
  codes: SignInCodeStore
  accounts: UserAccountStore
  profiles: ProfileStore
  install: InstallStore
  // Shared with the Connexion page: a wrong code counts as a wrong password from the same device.
  throttle: LoginThrottle
  secret: Buffer
  now: () => number
  cookieFor: CookieFor
  // "Mot de passe oublié": the new password, every device of the account signed out, and this one's cookie; null when
  // this device signs in on the Connexion page instead (« Validation en deux étapes »).
  resetPassword?: (account: UserAccount, passwordHash: string, request: express.Request) => string | null
  // What a new profile starts with, as one added in Réglages > Profils.
  onProfileCreated?: (profileId: number) => void
  // The plugins' say on an existing account signing in again with a new password.
  checkSignIn?: CheckSignIn
  // false for an account with « Validation en deux étapes » on: what the code does is done, but this device signs in
  // on the Connexion page, with the app's code.
  signsInHere?: (account: UserAccount) => boolean
}

export type ResolvedJoinOptions = CodeJoinOptions & Required<Pick<CodeJoinOptions, 'checkSignIn' | 'signsInHere'>>

// What "Bienvenue sur Hodi" and "Ton profil t'attend" show of a profile: no photo, which only a session may load.
const publicProfile = ({ id, name, color, kind, avatar }: Profile) => ({ id, name, color, kind, avatar })

// Whether a code may set a new password for this account: never the server's admin's, which would hand the whole
// server to whoever holds the code. Theirs goes through « Mot de passe oublié » by e-mail.
export const resettableByCode = (account: UserAccount) => !account.serverAdmin

// The cookies of a device that now reads as this profile, after its session cookie.
export const withProfileCookie = (
  { profiles, secret }: Pick<CodeJoinOptions, 'profiles' | 'secret'>,
  sessionCookie: string,
  profileId: number
) => [sessionCookie, profileCookie(profileToken(profileId, profiles.lock(profileId)?.version ?? 0, secret))]

export const codeHelpers = ({ codes, accounts, profiles, install, throttle, now, resetPassword }: CodeJoinOptions) => {
  // Checked again when the code is used: the account may have become the server's admin since the code was made.
  const resettable = (profileId: number) => {
    const account = accounts.ofProfile(profileId)
    return account !== null && resettableByCode(account)
  }

  // A profile's code holds while it still waits for it: an adult without an account or, for a reset, an adult who
  // has one. A young one signs in with its own account.
  const waitsForCode = (found: SignInCode, target: Profile) => {
    if (isYoung(target)) return false
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
    const found = code && install.isSetUp() ? codes.peek(code, now()) : null
    const target = found?.profileId ? profiles.find(found.profileId) : null
    const waiting = target && waitsForCode(found!, target)
    if (!found || (found.profileId !== null && !waiting)) {
      throttle.recordFailure(now(), client)
      response.status(403).json({ error: 'invalid_code' })
      return null
    }
    return { code: code!, found, target }
  }

  const describe = ({ profileId, createdBy, reset }: SignInCode) => {
    if (profileId !== null) {
      const profile = profiles.find(profileId)!
      return { kind: reset ? 'reset' : 'profile', profile: publicProfile(profile) }
    }
    const by = createdBy === null ? null : profiles.find(createdBy)
    return { kind: 'invite', invitedBy: by ? publicProfile(by) : null }
  }

  return { validCode, describe }
}

export type CodeHelpers = ReturnType<typeof codeHelpers>
export type ValidCode = NonNullable<ReturnType<CodeHelpers['validCode']>>

// "J'ai un code": the new account the request asks for, or null when it is malformed.
export const joinRequestOf = (body: Record<string, unknown>) => {
  const email = cleanEmail(body.email)
  const draft = (body.profile ?? {}) as { name?: unknown; color?: unknown; handle?: unknown }
  if (!email || !isPassword(body.password) || body.ageConfirmed !== true) return null
  return { email, password: body.password as string, draft }
}
