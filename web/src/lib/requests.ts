import { useEffect, useSyncExternalStore } from 'react'
import { type SourceRequest, getSourceRequests } from '../api.ts'

// The teens' sources waiting for a parent ("Demandes"): on top of Réglages, and a count on its wheel. Asked when a
// screen that shows them opens, and when the app comes back on screen.

let state: SourceRequest[] = []
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const setPendingRequests = (next: SourceRequest[]) => {
  state = next
  listeners.forEach(listener => listener())
}

// A deleted profile's requests go with it (the server drops them too).
export const dropRequestsOf = (profileId: number) =>
  setPendingRequests(state.filter(request => request.profileId !== profileId))

export const refreshPendingRequests = () => {
  loading ??= getSourceRequests()
    .then(setPendingRequests)
    .catch(() => {})
    .finally(() => {
      loading = null
    })
  return loading
}

// enabled: only a parent answers them.
export const usePendingRequests = (enabled: boolean) => {
  const value = useSyncExternalStore(subscribe, () => state)
  useEffect(() => {
    if (!enabled) return
    void refreshPendingRequests()
    const refresh = () => {
      if (document.visibilityState === 'visible') void refreshPendingRequests()
    }
    document.addEventListener('visibilitychange', refresh)
    return () => document.removeEventListener('visibilitychange', refresh)
  }, [enabled])
  return enabled ? value : []
}
