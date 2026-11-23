import type express from 'express'
import { type Profile, type ProfileStore, isYoung } from '../db/profile-store.ts'
import type { UserAccountStore } from '../db/user-account-store.ts'
import type { UserStore } from '../db/user-store.ts'

export interface SharePeopleOptions {
  users: (profileId: number) => UserStore
  profiles?: ProfileStore
  // The people's accounts, their @usernames and families; absent in tests without accounts.
  accounts?: UserAccountStore
  // The accounts signed in on the device that asks.
  signedInHere?: (request: express.Request) => number[]
}

// "Envoyer à…" and Réglages › Partages: who a profile shares with. Two adults may share with each other, found by their
// @username; a teen or a child shares only within its family (its parents, its brothers and sisters), and nobody
// outside it reaches them. Offered at once: the family, the accounts signed in on this device, and whoever the profile
// shared with lately. A profile with no account yet is the household of before, where everyone shares.
export const sharePeople = ({ users, profiles, accounts, signedInHere }: SharePeopleOptions) => {
  // A profile with sharing off neither sends nor receives; one can also turn off what a given profile sends.
  const sharingOn = (profileId: number) => users(profileId).preferences()?.sharing !== false
  const mutedBy = (profileId: number) => {
    const muted = users(profileId).preferences()?.mutedSharers
    return Array.isArray(muted) ? (muted as number[]) : []
  }
  const accountOf = (profileId: number) => accounts?.ofProfile(profileId) ?? null

  // Its parents, its children, the children of its parents and the other parents of its children.
  const familyOf = (accountId: number) => {
    if (!accounts) return new Set<number>()
    const childrenOf = (parentId: number) => accounts.young.childrenOf(parentId).map(child => child.accountId)
    const parentsOf = (childId: number) => accounts.young.invitations.parentsOf(childId)
    const parents = parentsOf(accountId)
    const children = childrenOf(accountId)
    const family = [...parents, ...children, ...parents.flatMap(childrenOf), ...children.flatMap(parentsOf)]
    return new Set(family.filter(id => id !== accountId))
  }

  // family: the sender's, when the caller already has it (offered() asks for every profile).
  const mayShare = (from: Profile, to: Profile, family?: Set<number>) => {
    if (from.id === to.id || !sharingOn(from.id) || !sharingOn(to.id) || mutedBy(to.id).includes(from.id)) return false
    const young = isYoung(from) || isYoung(to)
    const sender = accountOf(from.id)
    const receiver = accountOf(to.id)
    // A profile with no account yet shares as before, except with a teen or a child, who keeps to its family.
    if (!sender || !receiver) return !young
    return !young || (family ?? familyOf(sender.id)).has(receiver.id)
  }

  // The people "Envoyer à…" offers before any @username is typed.
  const offered = (from: Profile, request: express.Request) => {
    const sender = accountOf(from.id)
    const family = sender ? familyOf(sender.id) : new Set<number>()
    const near = new Set([...family, ...(signedInHere?.(request) ?? [])])
    const before = new Set(users(from.id).sharedWith())
    return (profiles?.list() ?? []).filter(to => {
      if (!mayShare(from, to, family)) return false
      const receiver = accountOf(to.id)
      return !sender || !receiver || near.has(receiver.id) || before.has(to.id)
    })
  }

  // The adult (or family member) behind an @username, when this profile may send to them; else null.
  const byHandle = (from: Profile, handle: string) => {
    const account = accounts?.byHandle(handle.replace(/^@/, '').toLowerCase())
    const profileId = account ? accounts?.profileOf(account.id) : null
    const to = typeof profileId === 'number' ? (profiles?.get(profileId) ?? null) : null
    return to && mayShare(from, to) ? to : null
  }

  // A person as "Envoyer à…" and Réglages › Partages show them.
  const personOf = (profile: Profile) => ({
    id: profile.id,
    name: profile.name,
    color: profile.color,
    avatar: profile.avatar,
    photoVersion: profile.photoVersion,
    handle: accountOf(profile.id)?.handle ?? null
  })

  return { sharingOn, mutedBy, mayShare, offered, byHandle, personOf }
}

export type SharePeople = ReturnType<typeof sharePeople>
