import { useEffect, useSyncExternalStore } from 'react'
import { type ResumeEntry, UnauthorizedError, getResume } from '../api.ts'
import { getReadings } from './reading-stats.ts'
import { changeUserState, sendPendingChanges, subscribeUserState } from './user-state.ts'

// "Reprendre": the articles started lately and left before their end. Taken off with the cross, they stay off.

// Taken off here, before the server has it: a fetch in between must not bring them back.
const setAside = new Set<string>()

export const setAsideResume = (id: string) => {
  setAside.add(id)
  changeUserState(state => state, { method: 'DELETE', path: `/resume/${encodeURIComponent(id)}` })
}

// Where to take an article up again, once its text shows: given by the card it is opened from.
let resumeAt: { id: string; position: number } | null = null

export const resumeFrom = (id: string, position: number) => {
  resumeAt = { id, position }
}

export const resumePositionOf = (id: string) => (resumeAt?.id === id ? resumeAt.position : null)

// Once used: opening the article again from elsewhere starts at its top.
export const forgetResumePosition = () => {
  resumeAt = null
}

// The pile as last fetched, and whether it was asked once. A list waits for it, or the pile would come in above the
// list and push it down: both change in one update, so they show in the same frame.
let pile: { entries: ResumeEntry[]; ready: boolean } = { entries: [], ready: false }
const listeners = new Set<() => void>()
const subscribePile = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const setPile = (entries: ResumeEntry[]) => {
  pile = { entries, ready: true }
  listeners.forEach(listener => listener())
}

// The pile, for the list that shows it, which also asks for it (useResume) and waits until it is ready.
export const useResumeEntries = () =>
  useSyncExternalStore(subscribePile, () => pile).entries.filter(entry => !setAside.has(entry.item.id))

// Asks for the pile, again whenever the reading stats change: an article left, finished, or opened on another
// device. The progress just measured goes first: asked before the server has it, the article left would not be
// there. True once the pile was asked once. Nothing is asked for a list without a pile (enabled false).
export const useResume = (onUnauthorized: () => void, enabled = true) => {
  const readings = useSyncExternalStore(subscribeUserState, getReadings)

  useEffect(() => {
    if (!enabled) return
    let current = true
    sendPendingChanges()
      .then(() => getResume())
      .then(({ items }) => current && setPile(items))
      .catch((error: unknown) => {
        if (current && error instanceof UnauthorizedError) onUnauthorized()
        // Without it, the list shows all the same.
        if (current) setPile(pile.entries)
      })
    return () => {
      current = false
    }
  }, [readings, onUnauthorized, enabled])

  return useSyncExternalStore(subscribePile, () => pile.ready)
}
