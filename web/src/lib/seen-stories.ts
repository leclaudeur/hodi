import { useSyncExternalStore } from 'react'
import { sendSeenStories } from '../api.ts'

// Stories of "À la une" already looked at. Seeing a story is not reading the article: it stays unread in
// the lists, and only the story's ring turns grey. The server hears of it too, for the profile: on the next
// front page, on any device, the story makes room for one not seen yet.
export const SEEN_STORIES_KEY = 'hodi:seen-stories'
// Three stories per topic and day: enough for a few days.
const MAX_SEEN = 200

const load = (): string[] => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SEEN_STORIES_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter(id => typeof id === 'string') : []
  } catch {
    return []
  }
}

let seen = new Set(load())
const listeners = new Set<() => void>()

// Sent together a moment after the last one: a story viewer swiped through is one request.
const SEND_AFTER_MS = 1500
let unsent: string[] = []
let timer: ReturnType<typeof setTimeout> | null = null

const send = () => {
  if (timer) clearTimeout(timer)
  timer = null
  if (unsent.length === 0) return
  const ids = unsent
  unsent = []
  // Lost offline: the ring stays grey here, the story only keeps its place on the front page.
  sendSeenStories(ids).catch(() => {})
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', send)

export const isStorySeen = (id: string) => seen.has(id)

// An article's id, as the server takes them.
const ARTICLE_ID = /^[\w-]{16}$/

const remember = () => {
  try {
    localStorage.setItem(SEEN_STORIES_KEY, JSON.stringify([...seen]))
  } catch {
    // Private mode or full storage: remembered for this visit only.
  }
  listeners.forEach(listener => listener())
}

export const markStorySeen = (id: string) => {
  if (seen.has(id)) return
  seen = new Set([id, ...seen].slice(0, MAX_SEEN))
  // The Résumé du jour's story ("daily-summary:<date>") only greys its ring here: the front page holds articles.
  if (ARTICLE_ID.test(id)) {
    unsent.push(id)
    if (timer) clearTimeout(timer)
    timer = setTimeout(send, SEND_AFTER_MS)
  }
  remember()
}

export const useSeenStories = () =>
  useSyncExternalStore(
    listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => seen
  )
