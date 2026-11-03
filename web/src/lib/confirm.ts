import { type ReactNode, useSyncExternalStore } from 'react'

// A question before something that can't be undone ("Vider", "Réinitialiser"): a dialog over the page,
// answered by its two buttons. The toasts keep the news of what happened.

export interface Confirmation {
  title: string
  // What happens, in full: whose, for whom, what stays. A RichText puts the words that matter in bold.
  message: ReactNode
  // The button that does it: "Vider", "Effacer".
  label: string
  onConfirm: () => void
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

export const useConfirmation = () => useSyncExternalStore(subscribe, () => current)
