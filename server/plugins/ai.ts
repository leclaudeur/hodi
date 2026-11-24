import type { PluginQuestion } from '../news/summarizer.ts'
import { HOUR_MS } from '../../shared/time.ts'
import { CONFIG } from '../fixed-config.ts'

// ctx.ai: a plugin asks the server's AI, only in answer to a click on its AiButton (hodi:sdk). Hodi makes sure of it
// in the main thread: the click reaches /api/plugins/<id>/ai/<action>, which runs the plugin's aiActions[action]
// with a ticket for one question; a route, a task, a hook or a feed has no ticket, and a second question is refused.
// The question counts against the profile's 'plugin' caps (news-service.ts) and against an hourly cap of its own per
// plugin and profile, and the server's admin can turn a plugin's AI off.

export const MAX_PROMPT = CONFIG.pluginAi.promptMaxLength
export const MAX_SYSTEM = CONFIG.pluginAi.systemMaxLength
export const MAX_ANSWER_TOKENS = CONFIG.pluginAi.answerTokensMax
export const DEFAULT_ANSWER_TOKENS = CONFIG.pluginAi.answerTokensDefault
// What the plugin gets back, at most: an answer of MAX_ANSWER_TOKENS fits.
export const MAX_ANSWER = CONFIG.pluginAi.answerMaxLength
// What a click may hand the plugin's action, as JSON.
export const MAX_AI_INPUT_BYTES = CONFIG.pluginAi.inputMaxSize
// One plugin's questions for one profile, in an hour: a plugin cannot use the day's caps up at once.
export const PLUGIN_AI_PER_HOUR = CONFIG.pluginAi.perHour

// Why a click gets no answer: Hodi has no AI, the server's admin turned the plugin's off, a cap is reached, the
// AI declined the question, or the call failed.
export type PluginAiStatus = 'unavailable' | 'off' | 'limited' | 'refused' | 'failed'

export class PluginAiError extends Error {
  readonly status: PluginAiStatus
  constructor(status: PluginAiStatus) {
    super(`ai_${status}`)
    this.status = status
  }
}

// What a plugin may ask: plain text, within the sizes above; null for anything else.
export const pluginQuestion = (value: unknown): PluginQuestion | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const { prompt, system, maxTokens, ...rest } = value as Record<string, unknown>
  if (Object.keys(rest).length > 0) return null
  if (typeof prompt !== 'string' || prompt.trim() === '' || prompt.length > MAX_PROMPT) return null
  if (system !== undefined && (typeof system !== 'string' || system.length > MAX_SYSTEM)) return null
  if (
    maxTokens !== undefined &&
    (typeof maxTokens !== 'number' || !Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > MAX_ANSWER_TOKENS)
  )
    return null
  return {
    system: typeof system === 'string' ? system : '',
    prompt,
    maxTokens: typeof maxTokens === 'number' ? maxTokens : DEFAULT_ANSWER_TOKENS
  }
}

export interface PluginAskAnswer {
  status: 'ok' | 'unavailable' | 'limited' | 'refused' | 'failed'
  text?: string
}

export interface PluginAi {
  // Before the plugin runs: whether a click of this profile may ask anything now. null when it may.
  check: (pluginId: string, profileId: number) => PluginAiStatus | null
  // The question, once: the answer's text, or a PluginAiError.
  ask: (pluginId: string, profileId: number, question: PluginQuestion) => Promise<string>
}

// No AI at all (tests that do not need it): every click is answered 'unavailable'.
export const NO_PLUGIN_AI: PluginAi = {
  check: () => 'unavailable',
  ask: async () => {
    throw new PluginAiError('unavailable')
  }
}

export const pluginAi = ({
  isOff,
  left,
  ask,
  now = Date.now
}: {
  // Whether the server's admin turned this plugin's AI off.
  isOff: (pluginId: string) => boolean
  // Whether Hodi has AI and its 'plugin' caps leave this profile a call.
  left: (profileId: number) => boolean
  // One call to the AI, counted in the profile's caps (NewsService.askForPlugin).
  ask: (pluginId: string, profileId: number, question: PluginQuestion) => Promise<PluginAskAnswer>
  now?: () => number
}): PluginAi => {
  // The times of each plugin's questions for each profile, in the last hour. Kept in the main thread: a restart of
  // the plugin's thread cannot reset them. They live in memory, so a restart of Hodi does: the daily caps, counted in
  // the database (ai_calls), are what really holds.
  const asked = new Map<string, number[]>()
  const recent = (key: string, at: number) => (asked.get(key) ?? []).filter(time => at - time < HOUR_MS)

  const check = (pluginId: string, profileId: number): PluginAiStatus | null => {
    if (isOff(pluginId)) return 'off'
    if (recent(`${pluginId}|${profileId}`, now()).length >= PLUGIN_AI_PER_HOUR) return 'limited'
    return left(profileId) ? null : 'limited'
  }

  return {
    check,
    ask: async (pluginId, profileId, question) => {
      const refused = check(pluginId, profileId)
      if (refused) throw new PluginAiError(refused)
      const key = `${pluginId}|${profileId}`
      const at = now()
      asked.set(key, [...recent(key, at), at])
      const answer = await ask(pluginId, profileId, question)
      if (answer.status !== 'ok') throw new PluginAiError(answer.status)
      return (answer.text ?? '').slice(0, MAX_ANSWER)
    }
  }
}
