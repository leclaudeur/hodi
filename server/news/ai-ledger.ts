import type { AiCall, AiCallKind } from '../db/ai-queries.ts'
import type { NewsStore } from '../db/news-store.ts'
import { CONFIG } from '../fixed-config.ts'

const DAY_MS = 24 * 60 * 60 * 1000
const MINUTE_MS = 60 * 1000

// No cap on a day, but a runaway guard: far more than a person clicks in a minute, far less than a loop would.
export const AI_CALLS_PER_MINUTE = CONFIG.ai.callsPerMinute

export const AI_KINDS = ['summary', 'question', 'dailySummary', 'sources', 'plugin'] as const

export interface AiUsage {
  // False without an API key: no AI at all.
  available: boolean
  kinds: { kind: AiCallKind; used: number }[]
}

// The AI calls of the last day, by whom: everyone pays with their own key and sees what they used, with no daily cap.
export class AiLedger {
  #calls: AiCall[] = []
  readonly #store: NewsStore | undefined

  constructor({ store, now }: { store?: NewsStore; now: number }) {
    this.#store = store
    // The day's calls survive a restart.
    if (store) this.#calls = store.aiCalls(now - DAY_MS)
  }

  usage(profileId: number, now: number, available: boolean): AiUsage {
    const calls = this.#recent(now)
    return { available, kinds: AI_KINDS.map(kind => ({ kind, used: this.#used(calls, kind, profileId) })) }
  }

  // Records the call, unless this person already made AI_CALLS_PER_MINUTE in the last minute: then false, nothing sent.
  take(kind: AiCallKind, profileId: number, at: number, pluginId?: string) {
    const lastMinute = this.#calls.filter(call => call.profileId === profileId && call.at > at - MINUTE_MS)
    if (lastMinute.length >= AI_CALLS_PER_MINUTE) return false
    this.record(kind, profileId, at, pluginId)
    return true
  }

  record(kind: AiCallKind, profileId: number, at: number, pluginId?: string) {
    const call = { kind, at, profileId, ...(pluginId ? { pluginId } : {}) }
    this.#calls.push(call)
    this.#store?.recordAiCall(call)
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
    return calls.filter(call => call.kind === kind && call.profileId === profileId).length
  }

  #recent(now: number) {
    this.#calls = this.#calls.filter(call => call.at > now - DAY_MS)
    return this.#calls
  }
}
