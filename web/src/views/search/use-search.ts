import { useEffect, useState } from 'react'
import { type SearchResult, type Trend, UnauthorizedError, getTrends, searchArticles } from '../../api.ts'

// Waits for a pause in typing before asking the server.
const DEBOUNCE_MS = 300
export const MIN_LENGTH = 2
// The server checks matching articles it has not opened yet: searched again until it is done.
const POLL_INTERVAL_MS = 2500
const MAX_POLLS = 8

export type Results = ({ query: string } & SearchResult) | { query: string; error: true }

// Trends of the visit: worked out again by the server every ten minutes at most.
let knownTrends: Trend[] | null = null

export const useTrends = () => {
  const [trends, setTrends] = useState(knownTrends)
  useEffect(() => {
    getTrends()
      .then(next => {
        knownTrends = next
        setTrends(next)
      })
      .catch(() => {})
  }, [])
  return trends ?? []
}

export const useSearch = (trimmed: string, onUnauthorized: () => void) => {
  const [results, setResults] = useState<Results | null>(null)

  useEffect(() => {
    if (trimmed.length < MIN_LENGTH) return

    let cancelled = false
    let polls = 0
    const search = () => {
      searchArticles(trimmed)
        .then(result => {
          if (cancelled) return
          // Only while the page is shown: no requests for a hidden app.
          const polling = result.checking > 0 && ++polls < MAX_POLLS && document.visibilityState === 'visible'
          setResults({ query: trimmed, ...result, checking: polling ? result.checking : 0 })
          if (polling) timer = window.setTimeout(search, POLL_INTERVAL_MS)
        })
        .catch((searchError: unknown) => {
          if (cancelled) return
          if (searchError instanceof UnauthorizedError) onUnauthorized()
          else setResults({ query: trimmed, error: true })
        })
    }
    let timer = window.setTimeout(search, DEBOUNCE_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [trimmed, onUnauthorized])

  return trimmed.length >= MIN_LENGTH ? results : null
}
