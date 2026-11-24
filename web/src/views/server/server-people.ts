import { useEffect, useSyncExternalStore } from 'react'
import { type ServerAccount, type ServerHousehold, getServerAccounts, getServerHouseholds } from '../../api.ts'
import { numericDate } from '../../lib/format.ts'

export interface People {
  households: ServerHousehold[]
  accounts: ServerAccount[]
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
    .then(([{ households }, accounts]) => {
      people = { households, accounts }
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

// The first account, opened beside the list on a computer when none is chosen.
export const firstOf = (loaded: People | null) => (loaded ? String(loaded.accounts[0]?.id ?? '') : '')

// A page's title on a phone, as on a computer: the account's first name or else its e-mail.
export const titleOf = (item: string, loaded: People | null) => {
  const account = loaded?.accounts.find(entry => String(entry.id) === item)
  return account?.profile?.name ?? account?.email ?? ''
}
