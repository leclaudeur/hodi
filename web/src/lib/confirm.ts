import { type ReactNode, useSyncExternalStore } from 'react'

// A question before something that can't be undone ("Vider", "Réinitialiser"): a dialog over the page,
// answered by its two buttons. The toasts keep the news of what happened.

export interface Confirmation {
  title: string
  // What happens, in full: whose, for whom, what stays. A RichText puts the words that matter in bold.
  message: ReactNode
  // The button that does it: "Vider", "Effacer".
  label: string
  // Red by default; primary for what adds rather than deletes (installing a verified plugin).
  look?: 'danger' | 'primary'
  // Asks the account's own password first, and with « Validation en deux étapes » its app's code: for what hands
  // someone else's account over or deletes a person's data. onConfirm then answers once the server agreed, and a
  // refusal (wrong password or code) stays in the dialog. noPassword: an account without one (signed in a moment
  // ago), which gives only its code.
  // codeOnly: the app's code alone, whatever the session says (a plugin's sign-in, before any session).
  proof?: { noPassword?: boolean; codeOnly?: boolean }
  onConfirm: (proof: Proof) => void | Promise<void>
  // Escape, the cross, « Annuler » or a click outside.
  onCancel?: () => void
}

export interface Proof {
  password: string
  // The 6 digits of the authenticator app, or a recovery code.
  code: string
}

let current: Confirmation | null = null
const listeners = new Set<() => void>()

const set = (next: Confirmation | null) => {
  current = next
  listeners.forEach(listener => listener())
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const askToConfirm = (confirmation: Confirmation) => set(confirmation)

export const closeConfirmation = () => set(null)

// The question closed without its button: whoever asked is told.
export const cancelConfirmation = () => {
  const asked = current
  set(null)
  asked?.onCancel?.()
}

export const useConfirmation = () => useSyncExternalStore(subscribe, () => current)
