import { useEffect, useSyncExternalStore } from 'react'
import { type AiUsage, getAiUsage } from '../api.ts'

// Whether this person has AI at all, and their calls of the day for Mon compte › IA. Asked when an AI action shows,
// and again after each call.
let usage: AiUsage | null = null
const listeners = new Set<() => void>()

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// Asking costs nothing: it reads the day's counters. Several actions showing together ask once.
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

// Whether the household has AI at all; null while not known.
export const useAiAvailable = () => {
  useEffect(() => {
    void refreshAiUsage()
  }, [])
  return useSyncExternalStore(subscribe, () => usage?.available ?? null)
}
