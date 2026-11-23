import type express from 'express'
import type { Profile } from '../db/profile-store.ts'
import type { UserAccountStore } from '../db/user-account-store.ts'
import { isParentOf, profileIdOf } from './request-locals.ts'

// Whether the profile open here belongs to one of this young profile's parents. A young profile with no account yet
// (made before accounts, or in a test that writes it by hand) is any adult's of its household, as it always was; the
// server's admin is no parent of other people's children.
export const isParentOfYoung = (response: express.Response, accounts: UserAccountStore | undefined, young: Profile) => {
  if (!isParentOf(response)) return false
  const child = accounts?.ofProfile(young.id)
  if (!accounts || !child) return true
  const parent = accounts.ofProfile(profileIdOf(response))
  return parent !== null && accounts.young.isParent(parent.id, child.id)
}
