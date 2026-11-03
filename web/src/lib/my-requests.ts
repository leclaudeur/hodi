import { useEffect, useSyncExternalStore } from 'react'
import { type SourceRequest, getMySourceRequests } from '../api.ts'

// A teen's sources waiting for its parents ("Mes demandes"), shared by the settings menu and Sources.

let state: SourceRequest[] | null = null
const listeners = new Set<() => void>()

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const setMyRequests = (next: SourceRequest[]) => {
  state = next
  listeners.forEach(listener => listener())
}

export const refreshMyRequests = () =>
  getMySourceRequests()
    .then(setMyRequests)
    .catch(() => {})

// Asked again each time a screen that shows them opens. enabled: false for anyone but a teen.
export const useMyRequests = (enabled: boolean) => {
  const value = useSyncExternalStore(subscribe, () => state)
  useEffect(() => {
    if (enabled) void refreshMyRequests()
  }, [enabled])
  return enabled ? value : null
}
