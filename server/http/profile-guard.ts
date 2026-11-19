import { type Profile, isYoung } from '../db/profile-store.ts'
import type { UserAccount, UserAccountStore } from '../db/user-account-store.ts'

// What this device types before it opens a profile in "Qui lit ?". A private profile: its account's password, on any
// device. Any other adult: the household's Code parental when it has one, else nothing. An adult without an account
// yet stays closed until its person makes one with a code. A young profile opens without anything: its parents open
// it.
export type Guard = UserAccount | 'code' | 'no_account' | null

export const guardOf = (profile: Profile, accounts: UserAccountStore | undefined, parentalCode: boolean): Guard => {
  if (isYoung(profile) || !accounts) return null
  const owner = profile.hasAccount ? accounts.ofProfile(profile.id) : null
  if (!owner) return 'no_account'
  if (owner.privateProfile) return owner
  return parentalCode ? 'code' : null
}

export const isAccountGuard = (guard: Guard): guard is UserAccount => typeof guard === 'object' && guard !== null

// What « Qui lit ? » shows for the profile on this device; null: it opens at once. A browser trusted by the account
// (« Ne plus demander sur cet appareil ») opens its private profile without the password.
export type Lock = 'password' | 'code' | 'no_account'

export const lockOf = (guard: Guard, trusted: boolean): Lock | null => {
  if (guard === null) return null
  if (guard === 'code' || guard === 'no_account') return guard
  return trusted ? null : 'password'
}
