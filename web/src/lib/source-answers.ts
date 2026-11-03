import { useEffect, useSyncExternalStore } from 'react'
import { type SourceAnswer, getMySourceAnswers, seeMySourceAnswers } from '../api.ts'

// A teen's requests its parents answered and it has not seen yet: on top of its Réglages, and a count on the
// wheel. Asked when the app opens and when it comes back on screen; seen when the teen leaves Réglages or takes
// one away with its cross.

let state: SourceAnswer[] = []
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const set = (next: SourceAnswer[]) => {
  state = next
  listeners.forEach(listener => listener())
}

const refresh = () => {
  loading ??= getMySourceAnswers()
    .then(set)
    .catch(() => {})
    .finally(() => {
      loading = null
    })
  return loading
}

// The server forgets them; the list and the count go at once.
export const seeSourceAnswers = (ids: number[]) => {
  if (ids.length === 0) return
  set(state.filter(answer => !ids.includes(answer.id)))
  void seeMySourceAnswers(ids).catch(() => {})
}

// enabled: only a teen asks for sources.
export const useSourceAnswers = (enabled: boolean) => {
  const value = useSyncExternalStore(subscribe, () => state)
  useEffect(() => {
    if (!enabled) return
    void refresh()
    const again = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', again)
    return () => document.removeEventListener('visibilitychange', again)
  }, [enabled])
  return enabled ? value : []
}
