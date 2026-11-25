import type { PluginTranslations } from '../plugins/plugin-texts.ts'
import { UnauthorizedError, getJson, sendJson } from './http.ts'
import type { ArticleResult, FeedItem, SourceStatus } from './news.ts'
import { CONFIG } from '../lib/config.ts'
import type { AdminProof } from './plugins.ts'

// The reader's calls to the API in the last 24 hours, on its own key. No cap: the key is theirs.
export interface AiUsage {
  // False without a key: no AI at all.
  available: boolean
  kinds: { kind: 'summary' | 'question' | 'dailySummary' | 'sources' | 'plugin'; used: number }[]
}

export type AiKind = AiUsage['kinds'][number]['kind']

export const getAiUsage = () => getJson<AiUsage>('/ai-usage')

// The admin's « Plugins »: the active plugins whose AiButton may ask a reader's AI, each with the admin's calls of the
// last 24 hours and whether the household lets it.
export interface AiPlugin {
  id: string
  name: string
  translations: PluginTranslations
  on: boolean
  calls: number
}

export const getAiPlugins = async () => (await getJson<{ plugins: AiPlugin[] }>('/ai-usage/plugins')).plugins

export const setAiPluginOn = async (id: string, on: boolean) =>
  (await sendJson<{ plugins: AiPlugin[] }>('PUT', `/ai-usage/plugins/${encodeURIComponent(id)}`, { on })).plugins

export interface StorageUsage {
  databaseBytes: number
  backupBytes: number
  backups: number
  articles: number
  texts: number
}

export const getStorage = () => getJson<StorageUsage>('/storage')

// Empties the stored reader texts (saved articles keep theirs) and gives the new figures.
export const clearStoredTexts = (proof: AdminProof) => sendJson<StorageUsage>('DELETE', '/storage/texts', proof)

export const getSources = async () => (await getJson<{ sources: SourceStatus[] }>('/sources')).sources

export const getArticle = async (id: string): Promise<ArticleResult> => {
  const body = await getJson<ArticleResult | { error: string }>(`/articles/${encodeURIComponent(id)}`, [404, 502])

  return 'error' in body ? { status: 'not_found' } : body
}

// failed covers a server or network error: trying again may work.
export type SummaryResult =
  | { status: 'ok'; points: string[] }
  | { status: 'unavailable' | 'unknown' | 'unreadable' | 'failed' | 'refused' | 'limited' }

// Asks the AI for the key points of an article: the server calls the API once per article.
export const summarizeArticle = async (id: string): Promise<SummaryResult> => {
  const response = await fetch(`/api/articles/${encodeURIComponent(id)}/summary`, { method: 'POST' })

  if (response.status === 401) {
    throw new UnauthorizedError('Session expired')
  }

  const body = (await response.json().catch(() => null)) as
    { status: 'ok'; points: string[] } | { error: Exclude<SummaryResult['status'], 'ok'> } | null

  if (!body) return { status: 'failed' }
  return 'error' in body ? { status: body.error } : body
}

// A web page the answer drew on.
export interface AnswerSource {
  url: string
  title: string
}

export type AnswerResult =
  | { status: 'ok'; answer: string; sources: AnswerSource[] }
  | { status: 'unavailable' | 'unknown' | 'unreadable' | 'failed' | 'refused' | 'limited' }

export const MAX_QUESTION_LENGTH = CONFIG.ai.questionMaxLength

// Asks the AI a question about an article: each question is a new API call, with web searches when needed.
export const askQuestion = async (id: string, question: string): Promise<AnswerResult> => {
  const response = await fetch(`/api/articles/${encodeURIComponent(id)}/question`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question })
  })

  if (response.status === 401) {
    throw new UnauthorizedError('Session expired')
  }

  const body = (await response.json().catch(() => null)) as
    | { status: 'ok'; answer: string; sources?: AnswerSource[] }
    | { error: Exclude<AnswerResult['status'], 'ok'> | 'bad_request' }
    | null

  if (!body) return { status: 'failed' }
  if ('error' in body) return { status: body.error === 'bad_request' ? 'failed' : body.error }
  return { ...body, sources: body.sources ?? [] }
}

export interface DailySummaryPoint {
  topic: string
  // Null when the AI named a topic that is not on the front page.
  topicId: string | null
  text: string
}

// none: no daily summary written lately. pending: the server is still gathering the front page, ask again shortly.
export type DailySummaryResult =
  | { status: 'ok'; points: DailySummaryPoint[]; generatedAt: string }
  | { status: 'unavailable' | 'none' | 'pending' | 'failed' | 'refused' | 'limited' }

// "Le Résumé du jour": the day's news, a paragraph per topic, written by the AI from the front page.
// Reading the last one is free.
export const getDailySummary = () => getJson<DailySummaryResult>('/daily-summary')

// Writing a new one uses the API: only on the reader's request.
export const writeDailySummary = async (): Promise<DailySummaryResult> => {
  const response = await fetch('/api/daily-summary', { method: 'POST' })

  if (response.status === 401) {
    throw new UnauthorizedError('Session expired')
  }

  return ((await response.json().catch(() => null)) as DailySummaryResult | null) ?? { status: 'failed' }
}

export interface ListenSection {
  id: string
  label: string
  items: FeedItem[]
}

export interface ListenFeed {
  sections: ListenSection[]
  sources: SourceStatus[]
}

export const getListen = () => getJson<ListenFeed>('/listen')
