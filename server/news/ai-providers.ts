import Anthropic, { AuthenticationError, PermissionDeniedError } from '@anthropic-ai/sdk'
import { createDailySummaryWriter } from './daily-summary.ts'
import type { AiTools } from './news-types.ts'
import {
  DEFAULT_SUMMARY_MODEL,
  createAiClient,
  createPluginAsker,
  createQuestionAnswerer,
  createSourceSuggester,
  createSummarizer
} from './summarizer.ts'

// The AIs a household can pick, in the first-run screens or in Réglages > IA et crédits. Claude only for now:
// another one adds an entry here, with the same tasks behind it.

// Where the household is, for the date in prompts and the web search's results.
export interface AiRegion {
  timeZone: string
  country: string | null
}

// ok: the key opens the API; invalid: it was refused; unreachable: no answer, it may still be good.
export type KeyCheck = 'ok' | 'invalid' | 'unreachable'

export interface AiProvider {
  id: string
  // As the settings show it.
  name: string
  defaultModel: string
  // Where its keys are made, for the first-run screen's link.
  keysUrl: string
  // A key's look, to catch a paste of something else before any request.
  keyPattern: RegExp
  // Asks the API who the key is, which costs no credits.
  checkKey: (key: string) => Promise<KeyCheck>
  tools: (settings: { key: string; model: string | null; region: AiRegion }) => AiTools
}

const anthropic: AiProvider = {
  id: 'anthropic',
  name: 'Claude (Anthropic)',
  defaultModel: DEFAULT_SUMMARY_MODEL,
  keysUrl: 'https://console.anthropic.com/settings/keys',
  keyPattern: /^sk-ant-[\w-]{20,}$/,
  checkKey: async key => {
    try {
      await new Anthropic({ apiKey: key, maxRetries: 0, timeout: 10_000 }).models.list({ limit: 1 })
      return 'ok'
    } catch (error) {
      return error instanceof AuthenticationError || error instanceof PermissionDeniedError ? 'invalid' : 'unreachable'
    }
  },
  tools: ({ key, model, region }) => {
    const ai = createAiClient({
      apiKey: key,
      model: model ?? DEFAULT_SUMMARY_MODEL,
      timeZone: region.timeZone,
      country: region.country
    })
    return {
      summarize: createSummarizer(ai),
      writeDailySummary: createDailySummaryWriter(ai),
      answerQuestion: createQuestionAnswerer(ai),
      suggestSources: createSourceSuggester(ai),
      askForPlugin: createPluginAsker(ai)
    }
  }
}

export const AI_PROVIDERS: AiProvider[] = [anthropic]

export const aiProvider = (id: unknown) => AI_PROVIDERS.find(provider => provider.id === id) ?? null
