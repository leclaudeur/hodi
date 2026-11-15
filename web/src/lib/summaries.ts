// AI summaries already generated, kept in this browser: reopening an article costs nothing. One per article and
// language: after a switch, the summary in the new language is asked of the server (free when it has one).
import type { Language } from './i18n.ts'

const STORAGE_KEY = 'hodi:summaries'
const MAX_SUMMARIES = 100
// Articles leave the feeds after three days.
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000

interface StoredSummary {
  points: string[]
  savedAt: number
}

const load = (): Record<string, StoredSummary> => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, StoredSummary>) : {}
  } catch {
    return {}
  }
}

// Kept before languages under the article's id alone: those are never found again, and age out.
const keyOf = (id: string, language: Language) => `${id} ${language}`

export const findSummary = (id: string, language: Language) => {
  const stored = load()[keyOf(id, language)]
  return stored && Array.isArray(stored.points) && Date.now() - stored.savedAt < MAX_AGE_MS ? stored.points : null
}

export const keepSummary = (id: string, language: Language, points: string[]) => {
  const now = Date.now()
  const kept = Object.entries({ ...load(), [keyOf(id, language)]: { points, savedAt: now } })
    .filter(([, summary]) => now - summary.savedAt < MAX_AGE_MS)
    .sort(([, a], [, b]) => b.savedAt - a.savedAt)
    .slice(0, MAX_SUMMARIES)

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(kept)))
  } catch {
    // Private browsing or full storage: the summary only lasts for this visit.
  }
}
