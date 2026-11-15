import { useSyncExternalStore } from 'react'

// Whether the device has a network, and when the server last answered (its Date header: a copy the
// service worker kept offline still carries the time it was sent).
interface Connection {
  online: boolean
  lastUpdate: number | null
}

let state: Connection = { online: navigator.onLine, lastUpdate: null }
const listeners = new Set<() => void>()

const set = (change: Partial<Connection>) => {
  state = { ...state, ...change }
  listeners.forEach(listener => listener())
}

const update = () => set({ online: navigator.onLine })

const subscribe = (listener: () => void) => {
  if (listeners.size === 0) {
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
  }
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }
}

export const noteResponse = (response: Response) => {
  const sent = Date.parse(response.headers.get('date') ?? '')
  if (!Number.isNaN(sent) && (state.lastUpdate === null || sent > state.lastUpdate)) set({ lastUpdate: sent })
}

export const useConnection = () => useSyncExternalStore(subscribe, () => state)
