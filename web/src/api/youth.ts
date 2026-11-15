import { getJson, sendJson } from './http.ts'
import type { FeedItem } from './news.ts'

// A young profile's rules, set by its parents (Réglages > Profils > Gérer). Times are "HH:MM" in the household's
// time zone.
export interface TimeRange {
  start: string
  end: string
}

export interface YouthRules {
  // null: no limit; 30 to 240, by 15.
  dailyMinutes: number | null
  // When it may read; null: all day.
  window: TimeRange | null
  // No notification then; null: none.
  quiet: TimeRange | null
  explainPerDay: number
}

export const DAILY_MINUTES = { min: 5, max: 240, step: 5, fastSteps: [15, 30] } as const
export const MAX_EXPLAIN_PER_DAY = 20

// open: it reads; before / after: outside its hours; time_up: today's minutes are spent.
export interface YouthLimits {
  rules: YouthRules
  usedSeconds: number
  remainingSeconds: number | null
  access: 'open' | 'before' | 'after' | 'time_up'
  opensAt: number | null
  closesAt: number | null
}

export const getYouthRules = (id: number) => getJson<YouthLimits>(`/profiles/${id}/rules`)

export const setYouthRules = (id: number, change: Partial<YouthRules>) =>
  sendJson<YouthLimits>('PUT', `/profiles/${id}/rules`, change)

// Its parents' catalogue for it, theme by theme.
export interface YouthCatalogueTopic {
  id: string
  label: string
  sources: { id: string; name: string; site: string; on: boolean }[]
}

export const getYouthSources = async (id: number) =>
  (await getJson<{ topics: YouthCatalogueTopic[] }>(`/profiles/${id}/sources`)).topics

export const setYouthSources = async (id: number, on: string[]) =>
  (await sendJson<{ topics: YouthCatalogueTopic[] }>('PUT', `/profiles/${id}/sources`, { on })).topics

export interface YouthTopic {
  id: string
  label: string
  on: boolean
}

export const getYouthTopics = async (id: number) =>
  (await getJson<{ topics: YouthTopic[] }>(`/profiles/${id}/topics`)).topics

export const setYouthTopics = async (id: number, hidden: string[]) =>
  (await sendJson<{ topics: YouthTopic[] }>('PUT', `/profiles/${id}/topics`, { hidden })).topics

// Its last seven days, today last: time on screen, how much it read, and its themes (never titles).
export interface YouthWeek {
  days: { day: string; seconds: number }[]
  articles: number
  videos: number
  topics: { id: string; count: number }[]
}

export const getYouthWeek = (id: number) => getJson<YouthWeek>(`/profiles/${id}/week`)

// The open profile's limits: an adult has none.
export type MyLimits = { limited: false } | ({ limited: true } & YouthLimits)

export const getMyLimits = () => getJson<MyLimits>('/me/limits')

// The app is on screen: the server counts the time since the last one.
export const sendHeartbeat = () => sendJson<MyLimits>('POST', '/me/time')

// "Demander une source": a teen's request, as found from its link, until a parent answers.
export interface SourceRequest {
  id: number
  profileId: number
  source: { name: string; url: string; kind: FeedItem['kind']; lang: 'fr' | 'en'; domains: string[] }
  status: 'pending' | 'accepted' | 'refused'
  at: number
}

export const getMySourceRequests = async () =>
  (await getJson<{ requests: SourceRequest[] }>('/me/source-requests')).requests

// A request its parents answered, shown once on top of the teen's Réglages.
export interface SourceAnswer extends SourceRequest {
  status: 'accepted' | 'refused'
  decidedAt: number
}

export const getMySourceAnswers = async () =>
  (await getJson<{ answers: SourceAnswer[] }>('/me/source-requests/answers')).answers

export const seeMySourceAnswers = (ids: number[]) => sendJson<void>('POST', '/me/source-requests/answers/seen', { ids })

// Refused with the reason: 'following' (it reads it already), 'pending' (asked already), 'full' (three waiting), or the finder's ('none',
// 'invalid', 'blocked', 'empty', 'failed', 'reddit').
// As the server: a teen waits for this many answers at most.
export const MAX_PENDING_REQUESTS = 3

export const askForSource = (url: string) => sendJson<SourceRequest>('POST', '/me/source-requests', { url })

// The parents' side: every teen's pending request ("Demandes").
export const getSourceRequests = async () => (await getJson<{ requests: SourceRequest[] }>('/source-requests')).requests

// topicIds: where a source new to the household goes. Answers with the requests still pending.
export const answerSourceRequest = async (id: number, accept: boolean, topicIds?: string[]) =>
  (await sendJson<{ requests: SourceRequest[] }>('POST', `/source-requests/${id}`, { accept, topicIds })).requests
