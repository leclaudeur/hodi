import { useEffect, useSyncExternalStore } from 'react'
import { type FeedItem, type ListenFeed, type TopicItem, UnauthorizedError, getListen } from '../api.ts'
import { t } from './i18n.ts'

// "Vidéos": the videos and episodes of the last 60 days, loaded once for the visit and again
// when the app comes back to them after a while.
const STALE_AFTER_MS = 10 * 60 * 1000

interface ListenState {
  feed: ListenFeed | null
  loading: boolean
  error: boolean
  unauthorized: boolean
  loadedAt: number
}

let state: ListenState = { feed: null, loading: false, error: false, unauthorized: false, loadedAt: 0 }
const listeners = new Set<() => void>()

const set = (change: Partial<ListenState>) => {
  state = { ...state, ...change }
  listeners.forEach(listener => listener())
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const subscribeListen = subscribe
export const getListenFeed = () => state.feed

export const refreshListen = async () => {
  if (state.loading) return
  set({ loading: true, error: false })
  try {
    set({ feed: await getListen(), loading: false, loadedAt: Date.now() })
  } catch (error) {
    set({ loading: false, error: true, unauthorized: error instanceof UnauthorizedError })
  }
}

export const useListen = (onUnauthorized: () => void) => {
  const current = useSyncExternalStore(subscribe, () => state)

  useEffect(() => {
    if (!state.loading && Date.now() - state.loadedAt > STALE_AFTER_MS) void refreshListen()
  }, [])

  useEffect(() => {
    if (current.unauthorized) onUnauthorized()
  }, [current.unauthorized, onUnauthorized])

  return current
}

// A video or an episode, wherever its section lists it.
export const findListenItem = (feed: ListenFeed | null, itemId: string) => {
  for (const section of feed?.sections ?? []) {
    const item = section.items.find(entry => entry.id === itemId)
    if (item) return { item, sectionId: section.id, sectionLabel: section.label }
  }
  return null
}

// Saved like an article; it opens in Vidéos again, never in the reader.
export const asSaved = (item: FeedItem): TopicItem => ({ ...item, access: 'link' })

export const isPlayable = (item: Pick<FeedItem, 'kind'>) => item.kind === 'video' || item.kind === 'podcast'

// The words of the read and hidden states, as fits an article, a video or an episode.
export const stateWords = (item: Pick<FeedItem, 'kind'>) => {
  const kind = item.kind === 'video' ? 'video' : item.kind === 'podcast' ? 'podcast' : 'article'
  return { read: t(`state.read.${kind}`), hidden: t(`state.hidden.${kind}`), undo: t(`state.undo.${kind}`) }
}
