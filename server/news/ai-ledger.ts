import type { AiCall, AiCallKind, AiCleared } from '../db/ai-queries.ts'
import type { NewsStore } from '../db/news-store.ts'

const DAY_MS = 24 * 60 * 60 * 1000

// A safety net for the API bill: calls per rolling day for the household, shared out between its profiles.
export const MAX_SUMMARIES_PER_DAY = 100
export const MAX_DAILY_SUMMARIES_PER_DAY = 8
export const MAX_QUESTIONS_PER_DAY = 100
export const AI_KINDS = ['summary', 'question', 'dailySummary', 'sources', 'plugin'] as const

export type AiCaps = Record<AiCallKind, number>
// The household's daily caps.
export const AI_CAPS: AiCaps = {
  summary: MAX_SUMMARIES_PER_DAY,
  question: MAX_QUESTIONS_PER_DAY,
  dailySummary: MAX_DAILY_SUMMARIES_PER_DAY,
  // "Suggérer des sources": a few a day, to keep an eye on the credits.
  sources: 10,
  // Every plugin's AiButton together.
  plugin: 20
}

export interface CapProfile {
  id: number
  admin: boolean
}

// A profile's share of a household cap: the cap split evenly, what is left over given one by one to the admin
// first, then to the others in order. 9 between two profiles: 5 for the admin, 4 for the other.
export const profileCap = (household: number, profiles: CapProfile[], profileId: number) => {
  const ordered = [...profiles].sort((a, b) => Number(b.admin) - Number(a.admin) || a.id - b.id)
  const count = Math.max(1, ordered.length)
  const index = ordered.findIndex(profile => profile.id === profileId)
  return Math.floor(household / count) + (index >= 0 && index < household % count ? 1 : 0)
}

export interface AiUsage {
  // False without an API key: no AI at all.
  available: boolean
  // used and limit: the profile's; householdUsed and householdLimit: everyone's together.
  kinds: { kind: AiCallKind; used: number; limit: number; householdUsed: number; householdLimit: number }[]
  // Every profile's calls: all kinds together, then kind by kind against its own caps.
  profiles: { profileId: number; calls: number; kinds: { kind: AiCallKind; used: number; limit: number }[] }[]
}

// The AI calls of the last day, by whom, against the household's caps and each profile's share of them.
export class AiLedger {
  #calls: AiCall[] = []
  readonly #store: NewsStore | undefined
  readonly #profiles: () => CapProfile[]
  readonly #caps: AiCaps

  constructor({
    store,
    profiles,
    caps,
    now
  }: {
    store?: NewsStore
    profiles: () => CapProfile[]
    caps: AiCaps
    now: number
  }) {
    this.#store = store
    this.#profiles = profiles
    this.#caps = caps
    // The caps count calls across a restart.
    if (store) this.#calls = store.aiCalls(now - DAY_MS)
  }

  usage(profileId: number, now: number, available: boolean): AiUsage {
    const calls = this.#recent(now)
    const kinds = AI_KINDS.map(kind => ({
      kind,
      used: this.#profileUsed(calls, kind, profileId),
      limit: this.#profileCap(kind, profileId),
      householdUsed: this.#householdUsed(calls, kind),
      householdLimit: this.#caps[kind]
    }))
    const profiles = this.#profiles().map(({ id }) => ({
      profileId: id,
      calls: calls.filter(call => call.profileId === id && call.cleared === undefined).length,
      kinds: AI_KINDS.map(kind => ({
        kind,
        used: this.#profileUsed(calls, kind, id),
        limit: this.#profileCap(kind, id)
      }))
    }))
    return { available, kinds, profiles }
  }

  // "Remettre à 0" (the admin's): one kind or all. For the household, the calls count for no one any more; for a
  // profile, they no longer count for it, but the household keeps its real total.
  reset(kind: AiCallKind | null, profileId: number | null, now: number) {
    const level: AiCleared = profileId === null ? 'all' : 'profile'
    // The household's own profiles only: another household's calls are not this admin's to clear.
    const ids = profileId === null ? this.#householdProfileIds() : new Set([profileId])
    for (const call of this.#recent(now)) {
      if ((kind !== null && call.kind !== kind) || !ids.has(call.profileId)) continue
      if (call.cleared !== 'all') call.cleared = level
    }
    for (const id of ids) this.#store?.clearAiCalls(now - DAY_MS, level, kind, id)
  }

  // Whether both the household and the profile are still under the day's cap.
  hasLeft(kind: AiCallKind, profileId: number, now: number) {
    const calls = this.#recent(now)
    return (
      this.#householdUsed(calls, kind) < this.#caps[kind] &&
      this.#profileUsed(calls, kind, profileId) < this.#profileCap(kind, profileId)
    )
  }

  // Records a call when the caps leave room for it; false otherwise.
  take(kind: AiCallKind, profileId: number, at: number, pluginId?: string) {
    if (!this.hasLeft(kind, profileId, at)) return false
    const call = { kind, at, profileId, ...(pluginId ? { pluginId } : {}) }
    this.#calls.push(call)
    this.#store?.recordAiCall(call)
    return true
  }

  // The household's calls of each plugin in the last 24 hours, for Réglages › IA et crédits.
  pluginCalls(now: number): Record<string, number> {
    const ids = this.#householdProfileIds()
    const counts: Record<string, number> = {}
    for (const call of this.#recent(now)) {
      if (call.kind === 'plugin' && call.pluginId && ids.has(call.profileId))
        counts[call.pluginId] = (counts[call.pluginId] ?? 0) + 1
    }
    return counts
  }

  #profileUsed(calls: AiCall[], kind: AiCallKind, profileId: number) {
    return calls.filter(call => call.kind === kind && call.profileId === profileId && call.cleared === undefined).length
  }

  // The profiles of the household the request is for: its caps count their calls only.
  #householdProfileIds() {
    return new Set(this.#profiles().map(profile => profile.id))
  }

  #householdUsed(calls: AiCall[], kind: AiCallKind) {
    const ids = this.#householdProfileIds()
    return calls.filter(call => call.kind === kind && call.cleared !== 'all' && ids.has(call.profileId)).length
  }

  #profileCap(kind: AiCallKind, profileId: number) {
    return profileCap(this.#caps[kind], this.#profiles(), profileId)
  }

  #recent(now: number) {
    this.#calls = this.#calls.filter(call => call.at > now - DAY_MS)
    return this.#calls
  }
}
