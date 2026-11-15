import { useSyncExternalStore } from 'react'

// "Récentes": the last searches, on this device only.
export const RECENT_SEARCHES_KEY = 'hodi:recent-searches'
const MAX_RECENT = 5

const listeners = new Set<() => void>()
let recent: string[] | null = null

const load = (): string[] => {
  if (recent) return recent
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) ?? '[]')
    recent = Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : []
  } catch {
    recent = []
  }
  return recent
}

const store = (next: string[]) => {
  recent = next
  try {
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next))
  } catch {
    // Private browsing: kept for this visit only.
  }
  listeners.forEach(listener => listener())
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const useRecentSearches = () => useSyncExternalStore(subscribe, load)

// The newest first, once each whatever its case.
export const rememberSearch = (query: string) => {
  const trimmed = query.trim()
  if (!trimmed) return
  store([trimmed, ...load().filter(other => other.toLowerCase() !== trimmed.toLowerCase())].slice(0, MAX_RECENT))
}

export const forgetSearch = (query: string) => store(load().filter(other => other !== query))
