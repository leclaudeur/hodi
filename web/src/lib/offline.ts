import { useEffect, useSyncExternalStore } from 'react'
import { DATA_CACHE, type SearchItem } from '../api.ts'
import { useConnection } from './connection.ts'
import { isHidden, usePreferences } from './preferences.ts'
import { isRead } from './read-state.ts'
import { useSaved } from './saved.ts'

// "Lecture hors ligne": the unread articles of "Le fil" are fetched ahead, one at a time, while the app is open
// and online, so the service worker keeps their text (see public/sw.js). A setting of this device only.

const STORAGE_KEY = 'hodi:offline-reading'
// The service worker keeps the last 200 articles opened: room for these and the ones read.
const MAX_KEPT = 40

let enabled = (() => {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
})()
let kept = new Set<string>()
// Today's articles of "Le fil", as last listed: the cache also holds what other profiles and other days opened,
// which this profile's lists do not show. The server lists the whole household's: the profile's settings hide more.
let listed: SearchItem[] = []
let running: Promise<void> | null = null
const listeners = new Set<() => void>()

const notify = () => listeners.forEach(listener => listener())
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const ARTICLE_PATH = /^\/api\/articles\/([^/]+)$/

// The articles whose text this device holds, read from the service worker's cache.
export const refreshKept = async () => {
  if (!('caches' in window)) return
  try {
    const keys = await (await caches.open(DATA_CACHE)).keys()
    kept = new Set(
      keys.flatMap(request => {
        const match = ARTICLE_PATH.exec(new URL(request.url).pathname)
        return match?.[1] ? [decodeURIComponent(match[1])] : []
      })
    )
    notify()
  } catch {
    // No cache to read: nothing is shown as kept.
  }
}

// Waits a few seconds after the app opened, then for a moment the browser has nothing else to do.
const START_DELAY_MS = 5000
const afterStart = () =>
  new Promise<void>(resolve => {
    const wait = Math.max(0, START_DELAY_MS - performance.now())
    window.setTimeout(() => {
      if ('requestIdleCallback' in window) window.requestIdleCallback(() => resolve(), { timeout: 2000 })
      else resolve()
    }, wait)
  })

// Called with today's articles each time "Le fil" loads them. Never while hidden or offline: it stops there and
// carries on next time.
export const keepForOffline = (items: SearchItem[]) => {
  listed = items.filter(item => item.kind === 'article')
  notify()
  if (!enabled || running || !('caches' in window) || !('serviceWorker' in navigator)) return
  running = (async () => {
    // After the page has shown and its pictures came: these 40 downloads must not compete with them.
    await afterStart()
    await refreshKept()
    const wanted = items
      .filter(item => item.kind === 'article' && item.access === 'reader' && !isRead(item.id) && !kept.has(item.id))
      .slice(0, Math.max(0, MAX_KEPT - items.filter(item => kept.has(item.id)).length))
    for (const item of wanted) {
      if (!enabled || document.hidden || !navigator.onLine) break
      try {
        await fetch(`/api/articles/${encodeURIComponent(item.id)}`)
      } catch {
        break
      }
    }
    await refreshKept()
  })().finally(() => {
    running = null
  })
}

export const setOfflineReading = (on: boolean) => {
  enabled = on
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off')
  } catch {
    // Kept for this visit only.
  }
  notify()
}

export const useOfflineReading = () => useSyncExternalStore(subscribe, () => enabled)

// What the offline band counts: what can be read without a network, as the lists show it. The articles of this
// profile's "Le fil" kept on this device or saved with their text, unread and not hidden by its settings (topics,
// sources, muted words), and every saved article with its text, read or not: it stays in "Enregistrés".
export const useListedOffline = () => {
  const ids = useKeptOffline()
  const saved = useSaved()
  const preferences = usePreferences()
  const shown = useSyncExternalStore(subscribe, () => listed)
  const texts = saved.filter(entry => entry.article !== null).map(entry => entry.item.id)
  const fil = shown
    .filter(
      item =>
        (ids.has(item.id) || texts.includes(item.id)) &&
        !isRead(item.id) &&
        !preferences.hiddenTopics.includes(item.topicId) &&
        !isHidden(item, preferences)
    )
    .map(item => item.id)
  return [...new Set([...fil, ...texts])]
}

// The ids of the articles readable without a network.
export const useKeptOffline = () => {
  const value = useSyncExternalStore(subscribe, () => kept)
  useEffect(() => {
    void refreshKept()
  }, [])
  return value
}

// Without a network, only what can be read stays in the lists: the articles kept here and the saved ones with
// their text. Online, everything shows.
export const useReadableOffline = () => {
  const { online } = useConnection()
  const ids = useKeptOffline()
  const saved = useSaved()
  if (online) return () => true
  const texts = new Set(saved.filter(entry => entry.article !== null).map(entry => entry.item.id))
  return (item: { id: string }) => ids.has(item.id) || texts.has(item.id)
}
