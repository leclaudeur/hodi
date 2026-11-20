import { type Profile, isYoung } from '../db/profile-store.ts'
import type { UserAccount, UserAccountStore } from '../db/user-account-store.ts'

// The parent whose own Code parental opens their profile on this device.
export interface CodeGuard {
  codeOf: UserAccount
}

// What this device types before it opens a profile in "Qui lit ?". A private profile: its account's password, on any
// device. Any other adult: its own Code parental, when it has one and a young account is signed in on this device;
// else nothing. An adult without an account yet stays closed until its person makes one with a code. A young profile
// opens without anything: its parents open it.
export type Guard = UserAccount | CodeGuard | 'no_account' | null

export const guardOf = (profile: Profile, accounts: UserAccountStore | undefined, youngHere: boolean): Guard => {
  if (isYoung(profile) || !accounts) return null
  const owner = profile.hasAccount ? accounts.ofProfile(profile.id) : null
  if (!owner) return 'no_account'
  if (owner.privateProfile) return owner
  return youngHere && owner.parentalCode !== null ? { codeOf: owner } : null
}

export const isCodeGuard = (guard: Guard): guard is CodeGuard =>
  typeof guard === 'object' && guard !== null && 'codeOf' in guard

export const isAccountGuard = (guard: Guard): guard is UserAccount =>
  typeof guard === 'object' && guard !== null && !isCodeGuard(guard)

// What « Qui lit ? » shows for the profile on this device; null: it opens at once. A browser trusted by the account
// (« Ne plus demander sur cet appareil ») opens its private profile without the password.
export type Lock = 'password' | 'code' | 'no_account'

export const lockOf = (guard: Guard, trusted: boolean): Lock | null => {
  if (guard === null) return null
  if (guard === 'no_account') return guard
  if (isCodeGuard(guard)) return 'code'
  return trusted ? null : 'password'
}
