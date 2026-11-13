import { type Profile, isYoung } from '../db/profile-store.ts'
import type { UserAccount, UserAccountStore } from '../db/user-account-store.ts'

// What this device types before it opens a profile in "Qui lit ?": the password of the profile's account, every
// time, on any device. An adult without an account yet stays closed until its person makes one with a code. A young
// profile opens without anything: its parents open it.
export type Guard = UserAccount | 'no_account' | null

export const guardOf = (profile: Profile, accounts: UserAccountStore | undefined): Guard => {
  if (isYoung(profile) || !accounts) return null
  const owner = profile.hasAccount ? accounts.ofProfile(profile.id) : null
  return owner ?? 'no_account'
}
