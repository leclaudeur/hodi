import { useEffect, useSyncExternalStore } from 'react'
import { type DayFeed, type SearchItem, UnauthorizedError, getDay } from '../api.ts'
import { keepForOffline } from './offline.ts'
import { rememberRelated } from './related.ts'

// "Le fil" and each topic, one day at a time: today first, then each earlier day on "Charger <jour>".
// Kept for the visit, so going back from the reader or switching views shows them at once.

// The server checks new articles in the background: today is asked again until it is done, a few times
// at most, never while the app is hidden.
const POLL_INTERVAL_MS = 3000
const MAX_POLLS = 12
// Coming back to a list after this long fetches today again.
const STALE_AFTER_MS = 5 * 60 * 1000

export interface DayFeedState {
  days: DayFeed[]
  loading: boolean
  error: boolean
  unauthorized: boolean
  loadedAt: number
  // Today is asked again for the articles still being checked. Once it gives up, they are no longer awaited.
  polling: boolean
}

const EMPTY: DayFeedState = { days: [], loading: false, error: false, unauthorized: false, loadedAt: 0, polling: false }

// Keyed by topic id, '' for every topic.
const states = new Map<string, DayFeedState>()
const listeners = new Map<string, Set<() => void>>()
const polls = new Map<string, number>()

const stateOf = (scope: string) => states.get(scope) ?? EMPTY

const set = (scope: string, change: Partial<DayFeedState>) => {
  states.set(scope, { ...stateOf(scope), ...change })
  listeners.get(scope)?.forEach(listener => listener())
}

const subscribe = (scope: string, listener: () => void) => {
  const group = listeners.get(scope) ?? new Set()
  group.add(listener)
  listeners.set(scope, group)
  return () => group.delete(listener)
}

const fetchDay = async (scope: string, day?: string) => {
  const feed = await getDay({ day, topicId: scope || undefined })
  rememberRelated(feed.items)
  return feed
}

const failed = (scope: string, error: unknown) =>
  set(scope, { loading: false, error: true, unauthorized: error instanceof UnauthorizedError })

// Today again (and what the server finished checking), keeping the earlier days already shown.
const refreshToday = async (scope: string) => {
  window.clearTimeout(polls.get(scope))
  set(scope, { loading: true, error: false })
  try {
    const today = await fetchDay(scope)
    const earlier = stateOf(scope).days.filter(day => day.day < today.day)
    set(scope, { days: [today, ...earlier], loading: false, loadedAt: Date.now(), polling: today.checking > 0 })
    if (today.checking > 0) schedulePoll(scope, 1)
    // What is already listed reads: kept ahead now, without waiting for the sources still being checked.
    if (scope === '') keepForOffline(today.items)
  } catch (error) {
    failed(scope, error)
  }
}

const schedulePoll = (scope: string, count: number) => {
  if (count > MAX_POLLS) {
    set(scope, { polling: false })
    return
  }
  const poll = async () => {
    if (document.hidden) {
      document.addEventListener('visibilitychange', poll, { once: true })
      return
    }
    try {
      const today = await fetchDay(scope)
      const days = stateOf(scope).days
      if (days[0]?.day !== today.day) return set(scope, { polling: false })
      set(scope, { days: [today, ...days.slice(1)], polling: today.checking > 0 })
      if (today.checking > 0) schedulePoll(scope, count + 1)
      if (scope === '') keepForOffline(today.items)
    } catch {
      // The list on screen stands; the next visit asks again.
      set(scope, { polling: false })
    }
  }
  polls.set(scope, window.setTimeout(poll, POLL_INTERVAL_MS))
}

export const loadPreviousDay = async (scope: string) => {
  const { days, loading } = stateOf(scope)
  const previous = days.at(-1)?.previousDay
  if (!previous || loading) return

  set(scope, { loading: true, error: false })
  try {
    const feed = await fetchDay(scope, previous)
    set(scope, { days: [...stateOf(scope).days, feed], loading: false })
  } catch (error) {
    failed(scope, error)
  }
}

// Pull to refresh: today again, now.
export const refreshDayFeed = (scope: string) => refreshToday(scope)

// The days of every topic (scope '') or of one topic. Today is fetched on first use and when stale.
export const useDayFeed = (scope: string) => {
  const state = useSyncExternalStore(
    listener => subscribe(scope, listener),
    () => stateOf(scope)
  )

  useEffect(() => {
    const { loadedAt, loading, days, polling } = stateOf(scope)
    if (!loading && Date.now() - loadedAt > STALE_AFTER_MS) void refreshToday(scope)
    // Back on a list left while its articles were being checked: asked again for a while.
    else if (!loading && !polling && (days[0]?.checking ?? 0) > 0) {
      set(scope, { polling: true })
      schedulePoll(scope, 1)
    }
    return () => {
      window.clearTimeout(polls.get(scope))
      // Left while asking: nothing is awaited any more (a loader would never end on coming back).
      if (stateOf(scope).polling) set(scope, { polling: false })
    }
  }, [scope])

  return state
}

// Every article listed so far for that scope, newest first.
export const itemsOf = (state: DayFeedState): SearchItem[] => state.days.flatMap(day => day.items)
