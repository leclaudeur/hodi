import { useSyncExternalStore } from 'react'

// Whether the account reading here has « Validation en deux étapes » on: the session says, and the account page
// changes it. The moments that ask for the password then ask for the app's code too, and /server opens only once it
// is on for its admin.

let on = false
const listeners = new Set<() => void>()

export const setTwoFactorOn = (next: boolean) => {
  if (next === on) return
  on = next
  listeners.forEach(listener => listener())
}

export const twoFactorOn = () => on

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const useTwoFactorOn = () => useSyncExternalStore(subscribe, twoFactorOn)

// Whether that account has no password of its own (« Se connecter avec Google »): the dialogs that ask for the
// password ask only for the code, a recent sign-in standing for the password.
let noPassword = false

export const setNoPassword = (next: boolean) => {
  noPassword = next
}

export const hasNoPassword = () => noPassword
