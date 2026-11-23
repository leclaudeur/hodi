import type { AiCall, AiCallKind } from '../db/ai-queries.ts'
import type { NewsStore } from '../db/news-store.ts'

const DAY_MS = 24 * 60 * 60 * 1000

// A safety net for each person's API bill: calls per rolling day, against their own key.
export const MAX_SUMMARIES_PER_DAY = 100
export const MAX_DAILY_SUMMARIES_PER_DAY = 8
export const MAX_QUESTIONS_PER_DAY = 100
export const AI_KINDS = ['summary', 'question', 'dailySummary', 'sources', 'plugin'] as const

export type AiCaps = Record<AiCallKind, number>
// Each account's daily caps.
export const AI_CAPS: AiCaps = {
  summary: MAX_SUMMARIES_PER_DAY,
  question: MAX_QUESTIONS_PER_DAY,
  dailySummary: MAX_DAILY_SUMMARIES_PER_DAY,
  // "Suggérer des sources": a few a day, to keep an eye on the credits.
  sources: 10,
  // Every plugin's AiButton together.
  plugin: 20
}

export interface AiUsage {
  // False without an API key: no AI at all.
  available: boolean
  kinds: { kind: AiCallKind; used: number; limit: number }[]
}

// The AI calls of the last day, by whom, each reader against its own caps: everyone pays with their own key.
export class AiLedger {
  #calls: AiCall[] = []
  readonly #store: NewsStore | undefined
  readonly #caps: AiCaps

  constructor({ store, caps, now }: { store?: NewsStore; caps: AiCaps; now: number }) {
    this.#store = store
    this.#caps = caps
    // The caps count calls across a restart.
    if (store) this.#calls = store.aiCalls(now - DAY_MS)
  }

  usage(profileId: number, now: number, available: boolean): AiUsage {
    const calls = this.#recent(now)
    const kinds = AI_KINDS.map(kind => ({ kind, used: this.#used(calls, kind, profileId), limit: this.#caps[kind] }))
    return { available, kinds }
  }

  // « Remettre à 0 »: the reader's own calls, one kind or all, count no more.
  reset(kind: AiCallKind | null, profileId: number, now: number) {
    for (const call of this.#recent(now)) {
      if ((kind === null || call.kind === kind) && call.profileId === profileId) call.cleared = 'profile'
    }
    this.#store?.clearAiCalls(now - DAY_MS, 'profile', kind, profileId)
  }

  hasLeft(kind: AiCallKind, profileId: number, now: number) {
    return this.#used(this.#recent(now), kind, profileId) < this.#caps[kind]
  }

  // Records a call when the cap leaves room for it; false otherwise.
  take(kind: AiCallKind, profileId: number, at: number, pluginId?: string) {
    if (!this.hasLeft(kind, profileId, at)) return false
    const call = { kind, at, profileId, ...(pluginId ? { pluginId } : {}) }
    this.#calls.push(call)
    this.#store?.recordAiCall(call)
    return true
  }

  // The reader's calls of each plugin in the last 24 hours, for its IA et crédits.
  pluginCalls(profileId: number, now: number): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const call of this.#recent(now)) {
      if (call.kind === 'plugin' && call.pluginId && call.profileId === profileId)
        counts[call.pluginId] = (counts[call.pluginId] ?? 0) + 1
    }
    return counts
  }

  #used(calls: AiCall[], kind: AiCallKind, profileId: number) {
    return calls.filter(call => call.kind === kind && call.profileId === profileId && call.cleared === undefined).length
  }

  #recent(now: number) {
    this.#calls = this.#calls.filter(call => call.at > now - DAY_MS)
    return this.#calls
  }
}
