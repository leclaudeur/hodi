import { useSyncExternalStore } from 'react'
import type { Article, TopicItem } from '../api.ts'
import { type StoredSavedEntry, changeUserState, getUserState, subscribeUserState } from './user-state.ts'

// "Enregistrés": kept on the server and shared by every device. The server also keeps the text of a saved
// article for good. This device keeps the texts it opened, so a saved article still opens offline.
const TEXTS_KEY = 'hodi:saved-texts'
const MAX_TEXTS = 100

export interface SavedEntry {
  item: TopicItem
  article: Article | null
  savedAt: string
}

const loadTexts = (): Record<string, Article> => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(TEXTS_KEY) ?? '{}')
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, Article>) : {}
  } catch {
    return {}
  }
}

let texts = loadTexts()

// Only the texts of articles still saved are kept; a full storage drops the oldest until they fit.
const keepTexts = (savedIds: string[]) => {
  const kept = savedIds.filter(id => texts[id]).slice(0, MAX_TEXTS)
  texts = Object.fromEntries(kept.map(id => [id, texts[id]!]))

  for (let count = kept.length; count >= 0; count--) {
    try {
      localStorage.setItem(
        TEXTS_KEY,
        JSON.stringify(Object.fromEntries(kept.slice(0, count).map(id => [id, texts[id]])))
      )
      return
    } catch {
      // Private browsing or full storage: try with fewer texts.
    }
  }
}

// Built again only when the state or a text changes, so components get the same list until then.
let source: StoredSavedEntry[] | null = null
let sourceTexts = texts
let entries: SavedEntry[] = []
const current = () => {
  const stored = getUserState().saved
  if (stored !== source || texts !== sourceTexts) {
    source = stored
    sourceTexts = texts
    entries = stored.map(entry => ({
      item: entry.item as unknown as TopicItem,
      article: texts[entry.item.id] ?? null,
      savedAt: entry.savedAt
    }))
  }
  return entries
}

export const getSaved = current

export const useSaved = () => useSyncExternalStore(subscribeUserState, current)

export const findSaved = (id: string) => current().find(entry => entry.item.id === id)

export const save = (item: TopicItem, article: Article | null = null) => {
  const existing = findSaved(item.id)

  if (article) {
    texts = { ...texts, [item.id]: article }
    keepTexts([item.id, ...current().map(entry => entry.item.id)])
  }

  // Only the text was new: the server already has the item.
  if (existing) return

  const entry: StoredSavedEntry = {
    item: item as unknown as StoredSavedEntry['item'],
    savedAt: new Date().toISOString()
  }
  changeUserState(state => ({ ...state, saved: [entry, ...state.saved] }), {
    method: 'PUT',
    path: `/saved/${item.id}`,
    body: { item }
  })
}

export const unsave = (id: string) => {
  changeUserState(state => ({ ...state, saved: state.saved.filter(entry => entry.item.id !== id) }), {
    method: 'DELETE',
    path: `/saved/${id}`
  })
  keepTexts(current().map(entry => entry.item.id))
}
