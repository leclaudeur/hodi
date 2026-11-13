import { useEffect, useSyncExternalStore } from 'react'
import { type ServerAccount, type ServerHousehold, getServerAccounts, getServerHouseholds } from '../../api.ts'
import { numericDate } from '../../lib/format.ts'

export type PeopleKind = 'households' | 'accounts'

export interface People {
  households: ServerHousehold[]
  maxProfiles: number
  accounts: ServerAccount[]
  // The setup left the household for later: « Créer un foyer » takes it up again.
  canCreate: boolean
}

// Both lists, shared by the list column and the open page.
let people: People | null = null
let failed = false
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
let pending: Promise<void> | null = null
export const load = () =>
  (pending ??= Promise.all([getServerHouseholds(), getServerAccounts()])
    .then(([{ households, maxProfiles, canCreate }, accounts]) => {
      people = { households, maxProfiles, accounts, canCreate: canCreate === true }
      failed = false
    })
    .catch(() => {
      failed = true
    })
    .finally(() => {
      pending = null
      listeners.forEach(listener => listener())
    }))

// The lists, loaded again each time a list or a page of them opens (once for all that open together). `fresh`
// false: what is there, without asking for it.
export const usePeople = (fresh = true) => {
  useEffect(() => {
    if (fresh) void load()
  }, [fresh])
  return {
    people: useSyncExternalStore(subscribe, () => people),
    failed: useSyncExternalStore(subscribe, () => failed)
  }
}

export const dateOf = (at: number) => numericDate(new Date(at).toISOString())

// The first in a list, opened beside it on a computer when none is chosen.
export const firstOf = (kind: PeopleKind, loaded: People | null) =>
  loaded ? String((kind === 'households' ? loaded.households : loaded.accounts)[0]?.id ?? '') : ''

// A page's title on a phone, as on a computer: the household's name, the account's first name or else its e-mail.
export const titleOf = (kind: PeopleKind, item: string, loaded: People | null) =>
  (kind === 'households'
    ? loaded?.households.find(household => String(household.id) === item)?.name
    : (() => {
        const account = loaded?.accounts.find(entry => String(entry.id) === item)
        return account?.profile?.name ?? account?.email
      })()) ?? ''
