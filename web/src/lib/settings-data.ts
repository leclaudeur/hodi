import { useEffect, useState } from 'react'
import {
  type AiUsage,
  type Household,
  type SourceStatus,
  type StorageUsage,
  UnauthorizedError,
  getAiUsage,
  getHousehold,
  getSourceEngagement,
  getSources,
  getStorage
} from '../api.ts'

// What the settings show from the server: the feeds' state, the AI calls of the day and the disk used.
// Kept for the visit and asked again each time a settings screen opens.

const lastValues = new Map<string, unknown>()

const useCached = <T>(key: string, load: () => Promise<T>, onUnauthorized?: () => void) => {
  const [value, setValue] = useState<T | null>(() => (lastValues.get(key) as T | undefined) ?? null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    load()
      .then(next => {
        lastValues.set(key, next)
        if (!cancelled) setValue(next)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (error instanceof UnauthorizedError) onUnauthorized?.()
        else setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [key, load, onUnauthorized])

  // A newer value from another request (after "Vider").
  const replace = (next: T) => {
    lastValues.set(key, next)
    setValue(next)
  }

  return { value, failed: failed && value === null, replace }
}

export const useSourceStatuses = (onUnauthorized?: () => void) =>
  useCached<SourceStatus[]>('sources', getSources, onUnauthorized)

export const useSourceEngagement = (onUnauthorized?: () => void) =>
  useCached('engagement', getSourceEngagement, onUnauthorized)

export const useAiUsage = (onUnauthorized?: () => void) => useCached<AiUsage>('ai', getAiUsage, onUnauthorized)

// The admin's: the household's name, region and AI.
export const useHousehold = (onUnauthorized?: () => void) =>
  useCached<Household>('household', getHousehold, onUnauthorized)

export const useStorage = (onUnauthorized?: () => void) =>
  useCached<StorageUsage>('storage', getStorage, onUnauthorized)

// "ok", "error" or "idle" (not fetched since the server started).
export const sourceState = (source: SourceStatus) =>
  source.fetchedAt === null && source.error === null ? 'idle' : source.ok ? 'ok' : 'error'

// What this profile may still ask: its own cap, unless the household's runs out first.
export const callsLeft = (usage: AiUsage) =>
  usage.kinds.reduce(
    (total, kind) => total + Math.max(0, Math.min(kind.limit - kind.used, kind.householdLimit - kind.householdUsed)),
    0
  )
