import { useEffect, useSyncExternalStore } from 'react'
import { type AiKind, type AiUsage, getAiUsage } from '../api.ts'

// What this profile may still ask of the AI today, kind by kind: an action whose cap is reached is turned off
// instead of failing on its click. Asked when such an action shows, and again after each call.
let usage: AiUsage | null = null
const listeners = new Set<() => void>()

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// Asking costs nothing: it reads the day's counters. A failure leaves the actions on, the server still says no.
// Several actions showing together ask once.
let pending: Promise<void> | null = null

export const refreshAiUsage = () =>
  (pending ??= getAiUsage()
    .then(next => {
      usage = next
      listeners.forEach(listener => listener())
    })
    .catch(() => {})
    .finally(() => {
      pending = null
    }))

// Its own cap, unless the household's runs out first. Null while not known.
export const aiLeft = (kind: AiKind) => {
  const counts = usage?.kinds.find(entry => entry.kind === kind)
  return counts ? Math.max(0, Math.min(counts.limit - counts.used, counts.householdLimit - counts.householdUsed)) : null
}

// True once the day's cap of this kind is reached.
export const useAiCapped = (kind: AiKind) => {
  useEffect(() => {
    void refreshAiUsage()
  }, [])
  return useSyncExternalStore(subscribe, () => aiLeft(kind) === 0)
}
