import { useEffect, useState, useSyncExternalStore } from 'react'
import { type ListenFeed, type SearchItem, type TopicItem, UnauthorizedError, searchArticles } from '../api.ts'
import { dayOfItem } from './format.ts'
import { getListenFeed, subscribeListen, useListen } from './listen.ts'
import { followedWordOf, isHidden, usePreferences, type Preferences } from './preferences.ts'
import { isRead, useReadState } from './read-state.ts'
import { rememberRelated } from './related.ts'

// "Suivis": the articles of every topic about the subjects followed in the settings, newest first.
// The list and the counter beside "Suivis" share one result, so they always agree.

// The server checks matching articles it has not opened yet: search again until it is done, a few times.
const POLL_INTERVAL_MS = 3000
const MAX_POLLS = 6

// Videos and episodes about a subject show as long as articles do.
const VIDEO_WINDOW_MS = 3 * 24 * 60 * 60 * 1000

const byNewest = (a: TopicItem, b: TopicItem) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '')

// The last result, so coming back to the list shows it at once.
let last: { key: string; items: SearchItem[] } | null = null
// The search running for a set of subjects, shared by everyone asking for it.
let running: { key: string; done: Promise<void> } | null = null
const listeners = new Set<() => void>()

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const keyOf = (words: string[]) => words.join('\n')

const search = async (key: string) => {
  const followed = key.split('\n')
  for (let polls = 1; ; polls++) {
    const results = await Promise.all(followed.map(word => searchArticles(word)))
    const seen = new Set<string>()
    const items = results
      .flatMap(found => found.items)
      .filter(item => !seen.has(item.id) && seen.add(item.id))
      .sort(byNewest)
    rememberRelated(items)
    last = { key, items }
    listeners.forEach(listener => listener())

    if (!results.some(found => found.checking > 0) || polls >= MAX_POLLS || document.hidden) return
    await new Promise(resolve => window.setTimeout(resolve, POLL_INTERVAL_MS))
  }
}

// Searches the followed subjects, unless the same search is already running.
const refreshFollowed = (words: string[]) => {
  const key = keyOf(words)
  if (running?.key !== key) {
    const done = search(key).finally(() => {
      if (running?.done === done) running = null
    })
    running = { key, done }
  }
  return running.done
}

// The recent videos and episodes of "Vidéos", once it has loaded: the search covers the articles only.
const recentVideos = (feed: ListenFeed | null): TopicItem[] => {
  const since = new Date(Date.now() - VIDEO_WINDOW_MS).toISOString()
  const seen = new Set<string>()
  return (feed?.sections ?? [])
    .flatMap(section => section.items)
    .filter(item => !seen.has(item.id) && seen.add(item.id) && item.publishedAt !== null && item.publishedAt >= since)
    .map(item => ({ ...item, access: 'link' as const }))
}

// As in the topics: read and put-away articles leave (unless "Masquer les articles lus" is off), the other
// settings apply. Only articles about a followed subject as a whole are kept: the search also finds its words apart.
const shownItems = (preferences: Preferences, result: typeof last, feed: ListenFeed | null): TopicItem[] | null =>
  result?.key === keyOf(preferences.followedWords)
    ? [...result.items, ...recentVideos(feed)]
        .filter(item => !isHidden(item, preferences) && followedWordOf(item, preferences) !== null)
        .sort(byNewest)
    : null

export const useFollowedItems = (onUnauthorized: () => void) => {
  const preferences = usePreferences()
  const words = preferences.followedWords
  const key = keyOf(words)
  const result = useSyncExternalStore(subscribe, () => last)
  const { feed } = useListen(onUnauthorized)
  // An article put away (swipe, "Masquer") leaves the list at once.
  useReadState()
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!key) return
    let cancelled = false
    refreshFollowed(key.split('\n')).catch((loadError: unknown) => {
      if (cancelled) return
      if (loadError instanceof UnauthorizedError) onUnauthorized()
      else setError(true)
    })
    return () => {
      cancelled = true
    }
  }, [key, onUnauthorized])

  return { words, items: shownItems(preferences, result, feed), error: error && !result }
}

// The counter beside "Suivis": the list's unread articles of today, the day it opens on. Searched once per visit
// if the list was not opened.
export const useFollowedUnread = () => {
  const preferences = usePreferences()
  const key = keyOf(preferences.followedWords)
  const result = useSyncExternalStore(subscribe, () => last)
  const feed = useSyncExternalStore(subscribeListen, getListenFeed)
  useReadState()

  useEffect(() => {
    if (key && last?.key !== key) refreshFollowed(key.split('\n')).catch(() => {})
  }, [key])

  const today = dayOfItem(null)
  return (
    shownItems(preferences, result, feed)?.filter(item => !isRead(item.id) && dayOfItem(item.publishedAt) === today)
      .length ?? 0
  )
}
