import { noteResponse } from './lib/connection.ts'
import { type Language as InterfaceLanguage, isLanguage } from './lib/i18n.ts'
import { clearUserState } from './lib/user-state.ts'

export type LoginResult =
  | { ok: true }
  | { ok: false; reason: 'invalid_password' | 'error' }
  | { ok: false; reason: 'too_many_attempts'; retryAfterSeconds: number }

export interface Session {
  // False: the household's profiles are not picked on this device yet ("Qui lit ?").
  profileChosen: boolean
  // The household's: the interface's for every profile that did not pick its own.
  language: InterfaceLanguage | null
  // How the household writes the time of day.
  hourCycle: 12 | 24
}

// The session; null when logged out; 'setup' while the install waits for its first-run screens.
export const getSession = async (): Promise<Session | null | 'setup'> => {
  const response = await fetch('/api/session')

  if (response.status === 401) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    return body?.error === 'setup_required' ? 'setup' : null
  }

  if (!response.ok) {
    throw new Error(`Session check failed with status ${response.status}`)
  }

  const body = (await response.json()) as Partial<Session>
  return {
    profileChosen: body.profileChosen === true,
    language: isLanguage(body.language) ? body.language : null,
    hourCycle: body.hourCycle === 12 ? 12 : 24
  }
}

export const login = async (password: string): Promise<LoginResult> => {
  const response = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  })

  if (response.ok) {
    return { ok: true }
  }

  if (response.status === 401) {
    return { ok: false, reason: 'invalid_password' }
  }

  if (response.status === 429) {
    const body = (await response.json()) as { retryAfterSeconds?: number }
    return { ok: false, reason: 'too_many_attempts', retryAfterSeconds: body.retryAfterSeconds ?? 900 }
  }

  return { ok: false, reason: 'error' }
}

// Offline copies of the API kept by the service worker (same name in public/sw.js).
export const DATA_CACHE = 'hodi-data-v1'

export const logout = async () => {
  await fetch('/api/logout', { method: 'POST' })
  clearUserState()

  // Nothing read here stays on the device after logging out.
  await clearDataCache()
}

// The offline copies, which belong to the profile that read them.
export const clearDataCache = async () => {
  if ('caches' in window) await caches.delete(DATA_CACHE)
}

// ==========================================
// News
// Mirrors the server types in server/news.
// ==========================================

export type Language = 'fr' | 'en'

export interface FeedItem {
  id: string
  sourceId: string
  sourceName: string
  kind: 'article' | 'video' | 'podcast'
  lang: Language
  title: string
  summary: string
  link: string
  publishedAt: string | null
  image: string | null
  media: ItemMedia | null
}

// channelId: the channel's page opens from the player. Missing on videos fetched before it was read.
// durationSeconds: unknown for a video until the server has read its page.
export type ItemMedia =
  | { type: 'youtube'; videoId: string; channelId?: string; durationSeconds?: number }
  | { type: 'audio'; url: string; durationSeconds?: number }

// reader: opens in Hodi. link: summary only, read on the site.
export type Access = 'reader' | 'link'

// The same story from another source, shown with the article instead of as its own card.
export interface RelatedItem {
  id: string
  // Missing on articles saved before it was sent.
  sourceId?: string
  sourceName: string
  title: string
  link: string
  access: Access
  // Missing on articles saved before they were sent.
  image?: string | null
  readingMinutes?: number | null
}

// related, readingMinutes, author: always sent by the server; missing on articles saved before they existed.
// readingMinutes and author are null until the server has read the article.
export type TopicItem = FeedItem & {
  access: Access
  related?: RelatedItem[]
  readingMinutes?: number | null
  author?: string | null
  // A 16-pixel picture shown blurred while the card's picture loads; absent until the server made it.
  imagePreview?: string | null
}

export interface SourceStatus {
  id: string
  name: string
  kind: FeedItem['kind']
  lang: 'fr' | 'en'
  // The site or channel to visit.
  site: string
  ok: boolean
  itemCount: number
  fetchedAt: string | null
  error: string | null
  // Added from a link by this profile; missing for the catalogue's own sources.
  addedBy?: number
}

export interface TopicSummary {
  id: string
  label: string
}

export interface TopicInfo extends TopicSummary {
  // addedBy: the profile that added it; missing for the base sources.
  sources: { id: string; name: string; addedBy?: number }[]
}

export interface TopicFeed extends TopicSummary {
  items: TopicItem[]
  // Articles still being checked by the server: they appear once readable.
  checking: number
  // More articles wait after the requested limit ("Charger plus").
  hasMore: boolean
  sources: SourceStatus[]
}

export interface Article {
  title: string | null
  byline: string | null
  contentHtml: string
}

export type ArticleResult =
  | { status: 'ok'; item: FeedItem; article: Article; canSummarize?: boolean }
  | { status: 'unreadable' | 'failed'; item: FeedItem }
  | { status: 'not_found' }

// Thrown when the session expired: the app goes back to the login page.
export class UnauthorizedError extends Error {}

const getJson = async <T>(route: string, accept: number[] = []): Promise<T> => {
  const response = await fetch(`/api${route}`)

  if (response.status === 401) {
    throw new UnauthorizedError('Session expired')
  }

  if (!response.ok && !accept.includes(response.status)) {
    throw new Error(`GET ${route} failed with status ${response.status}`)
  }

  noteResponse(response)
  return (await response.json()) as T
}

export const getTopics = async () => (await getJson<{ topics: TopicInfo[] }>('/topics')).topics

export const TOPIC_PAGE_SIZE = 30

// fresh: the server fetches the feeds again (at most once a minute).
export const getTopic = (id: string, limit = TOPIC_PAGE_SIZE, fresh = false) =>
  getJson<TopicFeed>(`/topics/${encodeURIComponent(id)}?limit=${limit}${fresh ? '&fresh=1' : ''}`)

export interface FrontPageSection extends TopicSummary {
  items: TopicItem[]
  checking: number
}

// "À la une": the most covered stories of each topic.
export const getFrontPage = async () => (await getJson<{ sections: FrontPageSection[] }>('/front-page')).sections

// An article found by the search, with the topic it was found in.
export type SearchItem = TopicItem & { topicId: string; topicLabel: string }

export interface SearchResult {
  items: SearchItem[]
  // Matching articles the server is checking: searching again soon may find them.
  checking: number
}

// "Historique": the articles read in the last 7 days, last read first.
export interface HistoryEntry {
  item: SearchItem
  readAt: number
  // Put away from the lists without being opened.
  hidden?: boolean
}

export const getHistory = () => getJson<{ items: HistoryEntry[] }>('/me/history')

// "Reprendre": articles started lately and left before their end, newest first.
export interface ResumeEntry {
  item: SearchItem
  // Where it was left, from 0 to 1.
  position: number
  progress: number
  minutesLeft: number
}

export const getResume = () => getJson<{ items: ResumeEntry[] }>('/me/resume')

export const searchArticles = (query: string) => getJson<SearchResult>(`/search?q=${encodeURIComponent(query)}`)

// "Tendances · 48 h": the phrases most titles of the last two days share.
export interface Trend {
  label: string
  count: number
  topicId: string
}

export const getTrends = async () => (await getJson<{ trends: Trend[] }>('/trends')).trends

// "Le fil": one day of every topic, in this device's time zone.
export interface DayFeed {
  // YYYY-MM-DD.
  day: string
  items: SearchItem[]
  checking: number
  // The closest earlier day with articles ("Charger plus"), or null.
  previousDay: string | null
}

// One topic's days when topicId is given.
export const getDay = ({ day, topicId }: { day?: string; topicId?: string } = {}) => {
  const params = new URLSearchParams({ tz: Intl.DateTimeFormat().resolvedOptions().timeZone })
  if (day) params.set('day', day)
  if (topicId) params.set('topic', topicId)
  return getJson<DayFeed>(`/feed?${params}`)
}

// The source's icon; a 404 means it has none, and the app shows its initials.
export const sourceIconUrl = (sourceId: string) => `/api/sources/${encodeURIComponent(sourceId)}/icon`

// Calls to the API in the last 24 hours, against each daily cap.
export interface AiUsage {
  available: boolean
  // used and limit: this profile's; householdUsed and householdLimit: every profile's together.
  kinds: {
    kind: 'summary' | 'question' | 'dailySummary' | 'sources'
    used: number
    limit: number
    householdUsed: number
    householdLimit: number
  }[]
  // The admin's view: each profile's calls of the last 24 hours, every kind together, then kind by kind against
  // its own caps. Empty for a member.
  profiles: { profileId: number; calls: number; kinds: { kind: AiKind; used: number; limit: number }[] }[]
}

export type AiKind = AiUsage['kinds'][number]['kind']

export const getAiUsage = () => getJson<AiUsage>('/ai-usage')

// "Remettre à 0", the admin's: one kind or all (no kind), for one profile or the whole household (no profile).
export const resetAiUsage = async (reset: { kind?: AiKind; profileId?: number }): Promise<AiUsage> => {
  const response = await fetch('/api/ai-usage/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reset)
  })
  if (response.status === 401) throw new UnauthorizedError('Session expired')
  if (!response.ok) throw new Error(`POST /ai-usage/reset failed with status ${response.status}`)
  return (await response.json()) as AiUsage
}

export interface StorageUsage {
  databaseBytes: number
  backupBytes: number
  backups: number
  articles: number
  texts: number
}

export const getStorage = () => getJson<StorageUsage>('/storage')

// Empties the stored reader texts (saved articles keep theirs) and gives the new figures.
export const clearStoredTexts = async () => {
  const response = await fetch('/api/storage/texts', { method: 'DELETE' })
  if (response.status === 401) throw new UnauthorizedError('Session expired')
  if (!response.ok) throw new Error(`DELETE /storage/texts failed with status ${response.status}`)
  return (await response.json()) as StorageUsage
}

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

export const MAX_QUESTION_LENGTH = 300

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

// ==========================================
// Profiles
// Mirrors server/db/profile-store.ts.
// ==========================================

export const PROFILE_COLORS = [
  'belgique',
  'monde',
  'tech',
  'science',
  'films-series',
  'jeux-video',
  'ia',
  'broadcast',
  'sport',
  'musique'
] as const
export type ProfileColor = (typeof PROFILE_COLORS)[number]

// adult: a parent of the household's young profiles. teen and child: young profiles their parents set.
export const PROFILE_KINDS = ['adult', 'teen', 'child'] as const
export type ProfileKind = (typeof PROFILE_KINDS)[number]

// A child's drawn avatar (web/src/assets/avatars).
export const PROFILE_AVATARS = [
  'fox',
  'pirate',
  'astronaut',
  'robot',
  'dragon',
  'panda',
  'owl',
  'kitten',
  'trex',
  'koala',
  'reporter',
  'scientist'
] as const
export type ProfileAvatarName = (typeof PROFILE_AVATARS)[number]

export const MAX_PROFILES = 5
export const MAX_PROFILE_NAME_LENGTH = 24

// admin: manages every profile and the household's shared data. member: its own profile and settings.
export type ProfileRole = 'admin' | 'member'

export interface Profile {
  id: number
  name: string
  color: ProfileColor
  role: ProfileRole
  kind: ProfileKind
  // A child's drawn avatar; null for the others.
  avatar: ProfileAvatarName | null
  // Its own PIN is asked in "Qui lit ?": a private profile.
  locked: boolean
  // The household's Code parental is asked in "Qui lit ?": an adult that is not private, once there are young
  // profiles.
  parental: boolean
  // null: no photo, the initial shows.
  photoVersion: number | null
  // Added and never opened: its first visit, on any device, opens on the guided tour.
  tourPending: boolean
}

const sendJson = async <T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', route: string, body?: unknown) => {
  const response = await fetch(`/api${route}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  if (response.status === 401) throw new UnauthorizedError('Session expired')
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string; retryAfterSeconds?: number } | null
    throw new RequestError(response.status, body?.error ?? null, body?.retryAfterSeconds ?? null)
  }
  return (response.status === 204 ? null : await response.json()) as T
}

// A refused request and the server's reason: 'wrong_pin', 'too_many_attempts'…
export class RequestError extends Error {
  readonly status: number
  readonly code: string | null
  readonly retryAfterSeconds: number | null

  constructor(status: number, code: string | null, retryAfterSeconds: number | null) {
    super(`Request failed with status ${status}${code ? ` (${code})` : ''}`)
    this.status = status
    this.code = code
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export const PIN_LENGTH = 4
export const PIN_PATTERN = /^\d{4}$/

// "À la une" stories looked at: the next front page puts others first. Sent even as the page closes.
export const sendSeenStories = (ids: string[]) =>
  fetch('/api/me/stories/seen', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
    keepalive: true
  })

// parentalCode: whether the household has a Code parental.
export const getProfiles = () => getJson<{ profiles: Profile[]; current: number; parentalCode: boolean }>('/profiles')

export interface ProfileChanges {
  name?: string
  color?: ProfileColor
  kind?: ProfileKind
  avatar?: ProfileAvatarName
}

export const createProfile = (name: string, color: ProfileColor, { kind, avatar }: ProfileChanges = {}) =>
  sendJson<Profile>('POST', '/profiles', { name, color, kind, avatar })

export const updateProfile = (id: number, changes: ProfileChanges) =>
  sendJson<Profile>('PATCH', `/profiles/${id}`, changes)

// The admin's: pin null removes it; current: the code in place, if any.
export const setParentalPin = (pin: string | null, current?: string) =>
  sendJson<{ parentalCode: boolean }>('PUT', '/profiles/parental-pin', { pin, current })

export const deleteProfile = (id: number) => sendJson<null>('DELETE', `/profiles/${id}`)

// This device now reads as that profile, with its PIN when it has one.
export const chooseProfile = (id: number, pin?: string) =>
  sendJson<{ current: number }>('PUT', '/profiles/current', { id, pin })

// The admin's PIN: pin null removes it; current: the PIN in place, if any.
export const setProfilePin = (id: number, pin: string | null, current?: string) =>
  sendJson<Profile>('PUT', `/profiles/${id}/pin`, { pin, current })

export const uploadProfilePhoto = async (id: number, photo: Blob) => {
  const response = await fetch(`/api/profiles/${id}/photo`, {
    method: 'PUT',
    headers: { 'Content-Type': photo.type },
    body: photo
  })
  if (response.status === 401) throw new UnauthorizedError('Session expired')
  if (!response.ok) throw new Error(`PUT photo failed with status ${response.status}`)
  return (await response.json()) as Profile
}

export const takeProfileTour = (id: number) => sendJson<Profile>('POST', `/profiles/${id}/tour`)

export const removeProfilePhoto = (id: number) => sendJson<Profile>('DELETE', `/profiles/${id}/photo`)

export const profilePhotoUrl = (profile: Profile) =>
  profile.photoVersion === null ? null : `/api/profiles/${profile.id}/photo?v=${profile.photoVersion}`

// ==========================================
// Adding a source from a link
// Mirrors server/news/source-finder.ts and server/http/source-routes.ts.
// ==========================================

export interface FoundSource {
  name: string
  url: string
  kind: FeedItem['kind']
  // From the feed: French unless it says English.
  lang: FeedItem['lang']
  reader: boolean
  origin: 'feed' | 'youtube'
  readable: { tried: number; ok: number }
  samples: string[]
}

export type FindSourceResult = (
  { status: 'ok'; source: FoundSource } | { status: 'invalid' | 'blocked' | 'none' | 'empty' | 'failed' | 'reddit' }
) & {
  // Already in the catalogue.
  followed: { id: string; name: string } | null
  // This profile's added sources, and how many it may add.
  added: number
  limit: number
}

export const findSource = (url: string) => sendJson<FindSourceResult>('POST', '/sources/find', { url })

export type AddSourceError =
  'limit' | 'followed' | 'bad_section' | 'invalid' | 'blocked' | 'none' | 'empty' | 'failed' | 'reddit'

type AddSourceResult = { ok: true; id: string } | { ok: false; error: AddSourceError }

const postSource = async (path: string, body: object): Promise<AddSourceResult> => {
  const response = await fetch(`/api/sources${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (response.status === 401) throw new UnauthorizedError('Session expired')
  const result = (await response.json().catch(() => ({}))) as { id?: string; error?: AddSourceError }
  return response.ok && result.id ? { ok: true, id: result.id } : { ok: false, error: result.error ?? 'failed' }
}

// Articles go to one topic or several, videos to one section of Vidéos.
export const addSource = (url: string, section: 'topic' | 'listen', sectionIds: string[]) =>
  postSource('', { url, section, topicIds: sectionIds })

// "Sources proposées": sources.yml's sites not followed yet, by topic, added in one tap.
export interface SourceProposal {
  id: string
  name: string
  topicId: string
  lang: 'fr' | 'en'
  site: string
}

export const getProposals = async () => (await getJson<{ proposals: SourceProposal[] }>('/sources/proposals')).proposals

export const addProposal = (id: string, topicIds: string[]) =>
  postSource(`/proposals/${encodeURIComponent(id)}`, { topicIds })

// A source's topics, by the profile that added it or the admin.
export const setSourceTopics = (id: string, topicIds: string[]) =>
  sendJson<null>('PATCH', `/sources/${encodeURIComponent(id)}`, { topicIds })

// "Peu ouvertes": of each source shown, the articles or videos it listed and those the profile opened, over `days`.
// Mirrors server/news/engagement.ts.
export interface SourceEngagement {
  id: string
  articles: number
  read: number
  low: boolean
}

export const getSourceEngagement = () => getJson<{ days: number; sources: SourceEngagement[] }>('/sources/engagement')

// "Suggérer des sources": sites the AI names for a topic, each with its feed found and tried. One AI call.
// Mirrors server/http/source-routes.ts.
export type SourceSuggestions =
  | {
      status: 'ok'
      suggestions: { link: string; reason: string; source: FoundSource }[]
      added: number
      limit: number
    }
  | { status: 'unavailable' | 'not_found' | 'limited' | 'refused' | 'failed' }

export const suggestSources = (topicId: string, replacing: string | null) =>
  sendJson<SourceSuggestions>('POST', '/sources/suggest', { topicId, replacing })

export const removeSource = (id: string) => sendJson<null>('DELETE', `/sources/${encodeURIComponent(id)}`)

// The topics and sources changed (a source added or removed): the app asks for them again.
export const TOPICS_CHANGED = 'hodi:topics-changed'

// "Partages": articles another profile of the household sent here, newest first.
export interface ShareEntry {
  item: SearchItem
  // The profile that sent it.
  from: number
  sharedAt: number
  // The word that came with it, if any.
  note: string | null
  // The emoji sent back, if any.
  reaction: Reaction | null
}

export const getShares = () => getJson<{ items: ShareEntry[] }>('/me/shares')

// What the reader of a shared article can send back to its sender.
export const REACTIONS = ['👍', '❤️', '😂', '😮'] as const
export type Reaction = (typeof REACTIONS)[number]

// null takes it back.
export const reactToShare = (articleId: string, from: number, reaction: Reaction | null) =>
  sendJson<{ ok: true }>('POST', '/me/shares/reaction', { articleId, from, reaction })

// The reactions to what this profile sent, not shown yet.
export interface ShareReaction {
  item: SearchItem
  // The profile that reacted.
  to: number
  reaction: Reaction
  reactedAt: number
}

export const getShareReactions = () => getJson<{ items: ShareReaction[] }>('/me/shares/reactions')

export const markShareReactionsSeen = (until: number) =>
  sendJson<{ ok: true }>('POST', '/me/shares/reactions/seen', { until })

// The profiles an article can be sent to: the others that share, and did not turn this one off.
export const getShareTargets = async () => (await getJson<{ profiles: number[] }>('/me/share-targets')).profiles

export const shareArticle = (articleId: string, to: number[], note: string) =>
  sendJson<{ ok: true }>('POST', '/me/shares', { articleId, to, note })

// ==========================================
// The household: first-run screens, Réglages > Foyer and the AI's key
// Mirrors server/http/household-routes.ts.
// ==========================================

// Hodi's code, which the AGPL asks to offer to whoever uses it.
export const SOURCE_URL = 'https://github.com/leclaudeur/hodi'

export const MIN_PASSWORD_LENGTH = 8
// The setup code printed in the server's log, asked away from the server.
export const SETUP_CODE_LENGTH = 6
export const MAX_HOUSEHOLD_NAME_LENGTH = 40

export interface AiProviderInfo {
  id: string
  name: string
  // Where its keys are made.
  keysUrl: string
}

// ok: the key works; invalid: refused; unreachable: no answer from the provider.
export type KeyCheck = 'ok' | 'invalid' | 'unreachable'

export type SetupState =
  | { needed: true; codeRequired: boolean; providers: AiProviderInfo[] }
  | { needed: false; name: string; language?: InterfaceLanguage }

export const getSetup = () => getJson<SetupState>('/setup')

// The code from the server's log, when this device is away from the server.
export const checkSetupCode = (code: string) => sendJson<null>('POST', '/setup/code', { code })

export const checkSetupKey = async (code: string | null, provider: string, key: string) =>
  (await sendJson<{ result: KeyCheck }>('POST', '/setup/ai-check', { code, provider, key })).result

export interface HouseholdSetup {
  code: string | null
  name: string
  password: string
  profile: { name: string; color: ProfileColor }
  timeZone: string
  country: string | null
  language: InterfaceLanguage
  ai: { provider: string; key: string } | null
}

// Signs this device in as the household's admin.
export const setUpHousehold = (setup: HouseholdSetup) => sendJson<{ profileId: number | null }>('POST', '/setup', setup)

export interface Household {
  name: string
  passwordChangedAt: number | null
  timeZone: string
  country: string | null
  language: InterfaceLanguage
  hourCycle: 12 | 24
  ai: { provider: string; providerName: string; model: string; keyHint: string } | null
  providers: AiProviderInfo[]
}

export const getHousehold = () => getJson<Household>('/household')

export const updateHousehold = (changes: {
  name?: string
  timeZone?: string
  country?: string | null
  language?: InterfaceLanguage
  hourCycle?: 12 | 24
}) => sendJson<Household>('PATCH', '/household', changes)

// The other devices sign in again; this one stays.
export const changeHouseholdPassword = (current: string, next: string) =>
  sendJson<Household>('PUT', '/household/password', { current, next })

// Every other device goes back to the sign-in screen; this one stays signed in.
export const signOutOtherDevices = () => sendJson<null>('POST', '/household/sessions/revoke')

export const checkAiKey = async (provider: string, key: string) =>
  (await sendJson<{ result: KeyCheck }>('POST', '/household/ai/check', { provider, key })).result

// Kept only once the provider took it.
export const setHouseholdAi = (provider: string, key: string) =>
  sendJson<Household>('PUT', '/household/ai', { provider, key })

export const removeHouseholdAi = () => sendJson<Household>('DELETE', '/household/ai')

// The household game (gamification.yml): levels, badges, the week's challenge and ranking.
export type BadgeId =
  | 'early-bird'
  | 'night-owl'
  | 'faithful'
  | 'globetrotter'
  | 'all-rounder'
  | 'postman'
  | 'crowd-pleaser'
  | 'sleuth'
  | 'encyclopedia'
  | 'team-player'

// 0: not earned yet, then bronze, silver, gold.
export type BadgeTier = 0 | 1 | 2 | 3

export interface BadgeProgress {
  id: BadgeId
  name: string
  count: number
  tier: BadgeTier
  // What the next tier needs, or null once gold.
  next: number | null
  // What each tier needs: bronze, silver, gold.
  tiers: number[]
}

export interface WornBadge {
  id: BadgeId
  tier: BadgeTier
}

export interface GameLevel {
  // From 1.
  level: number
  name: string
  points: number
  // Where this level starts: its bar counts from there.
  since: number
  // The grade before, or null at the first.
  previous: { name: string } | null
  next: { name: string; points: number } | null
  // 0 to 1 of the way to the next level.
  progress: number
  // Earned since Monday.
  week: number
}

// Earned since one's own sheet was last opened: celebrated there once.
export interface GameNews {
  // The level reached, or null when it did not change.
  level: number | null
  badges: WornBadge[]
  // When the sheet was last opened, only with news.
  since?: number
}

export interface ProfileGame extends GameLevel {
  badges: BadgeProgress[]
  badge: WornBadge | null
  // One's own sheet only.
  news?: GameNews
}

export interface RankingEntry {
  profileId: number
  week: number
  level: number
  name: string
  progress: number
  badge: WornBadge | null
}

export interface HouseholdGame {
  enabled: boolean
  challenge: { goal: number; read: number; reached: boolean }
  // Most points this week first.
  ranking: RankingEntry[]
  // The profile asking: what its avatar shows as new.
  news: GameNews
}

export const getHouseholdGame = () => getJson<HouseholdGame>('/game')

// Every badge, earned or not, with its progress.
export const getMyGame = () => getJson<ProfileGame>('/me/game')

// Another profile's: only the badges it earned.
export const getProfileGame = (id: number) => getJson<ProfileGame>(`/game/profiles/${id}`)

export const wearBadge = (badge: BadgeId | null) =>
  sendJson<{ badge: BadgeId | null }>('PUT', '/me/game/badge', { badge })

// One's own sheet showed what was new.
export const markGameSeen = () => sendJson('POST', '/me/game/seen')

export const setGameEnabled = (enabled: boolean) => sendJson('PUT', '/game/enabled', { enabled })

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
