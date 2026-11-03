import type { Catalog, Language, Source, Topic } from './catalog.ts'
import { allSources, isAllowedHost, isSkipped, listenSources } from './catalog.ts'
import {
  type ExtractedArticle,
  articleAuthor,
  cleanArticleHtml,
  extractArticle,
  extractFeedContent,
  readingMinutes
} from './extract.ts'
import type { FetchText } from './fetch-text.ts'
import { type FeedItem, parseFeedEntries } from './feed-parser.ts'
import { sameStory } from './stories.ts'
import { removeSiteTemplate } from './site-template.ts'
import type { DailySummaryStory, WriteDailySummary, WrittenPoint } from './daily-summary.ts'
import {
  type AnswerQuestion,
  type AnswerSource,
  type SuggestSources,
  type SuggestedSite,
  type Summarize,
  SummaryRefusedError
} from './summarizer.ts'
import type { AiCall, AiCallKind, AiCleared, NewsStore, StoredItem, StoredVerdict } from '../db/news-store.ts'
import { type DayRange, dayOf, dayRange } from './days.ts'
import { titleKey } from './text.ts'
import type { FetchVideoDuration } from './video-durations.ts'
import { type Trend, trendsOf } from './trends.ts'
import { foldText, wordPattern } from './word-match.ts'
import { labelIn } from '../labels.ts'

// Feeds and checks are cached in memory for a short time; the store, when given, keeps articles,
// verdicts, reader text and AI output beyond a restart.
const CACHE_TTL_MS = 15 * 60 * 1000
const ERROR_TTL_MS = 60 * 1000
// "Tirer pour rafraîchir" fetches the feeds again, at most this often.
const FORCED_REFRESH_MIN_MS = 60 * 1000
// Older articles are left out: the news would be outdated.
const TOPIC_WINDOW_MS = 72 * 60 * 60 * 1000
// Videos and episodes older than this are left out of "Écouter et regarder".
const LISTEN_WINDOW_MS = 60 * 24 * 60 * 60 * 1000
const MAX_SHORT_SECONDS = 60
// A video page that gave no length is read again after this.
const DURATION_RETRY_MS = 60 * 60 * 1000
// Articles per page of a topic: the app asks for more with "Charger plus".
export const TOPIC_PAGE_SIZE = 30
export const MAX_TOPIC_LIMIT = 300
const MAX_SEARCH_RESULTS = 60
// Older articles the store finds for a search, before they are filtered like the feeds' ones.
const MAX_STORED_SEARCH_ROWS = 300
// "Le fil" skips this many empty days at most in one request.
const MAX_EMPTY_DAYS = 7
const MAX_SEARCH_CHECKS = 20
// "Tendances · 48 h": from the titles of the last two days, worked out again every ten minutes at most.
const TRENDS_WINDOW_MS = 48 * 60 * 60 * 1000
const TRENDS_TTL_MS = 10 * 60 * 1000
const MAX_CACHED_ARTICLES = 400
// How many other articles of a source show what its template repeats.
const TEMPLATE_SAMPLE = 5
// "À la une": stories per topic, taken from the last day when it has enough.
const FRONT_PAGE_SIZE = 3
const FRONT_PAGE_WINDOW_MS = 24 * 60 * 60 * 1000
// AI summaries: about 1 KB each, kept as long as the article stays in the feeds.
const MAX_CACHED_SUMMARIES = 200
const SUMMARY_TTL_MS = TOPIC_WINDOW_MS
// A safety net for the API bill: calls per rolling day for the household, shared out between its profiles.
export const MAX_SUMMARIES_PER_DAY = 100
const DAY_MS = 24 * 60 * 60 * 1000
// "Le Résumé du jour" is only written on request; a request this soon after the last one gets that one back.
const DAILY_SUMMARY_MIN_AGE_MS = 30 * 60 * 1000
// Older daily summaries are not shown any more.
// The daily summary is the day's: shown until midnight in the server's time zone (TZ), then the button offers a new one.
const sameDay = (a: number, b: number, timeZone: string) => dayOf(a, timeZone) === dayOf(b, timeZone)
export const MAX_DAILY_SUMMARIES_PER_DAY = 8
export const MAX_QUESTIONS_PER_DAY = 100
export const AI_KINDS = ['summary', 'question', 'dailySummary', 'sources'] as const

export type AiCaps = Record<AiCallKind, number>
// The household's daily caps.
export const AI_CAPS: AiCaps = {
  summary: MAX_SUMMARIES_PER_DAY,
  question: MAX_QUESTIONS_PER_DAY,
  dailySummary: MAX_DAILY_SUMMARIES_PER_DAY,
  // "Suggérer des sources": a few a day, to keep an eye on the credits.
  sources: 10
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
// The profile of a call made without one (tests, and the server before profiles).
const DEFAULT_PROFILE_ID = 1
// The front page must have this many stories before the daily summary is written, unless every topic is checked.
const MIN_DAILY_SUMMARY_STORIES = 12
// Readability verdicts are tiny and never change for a given article: keep many.
const MAX_VERDICTS = 5000

// readable: the article opens in the reader. image: its page's share image, if any.
// minutes and author: known once the article is read, shown on its card.
type Verdict = StoredVerdict
const CHECK_CONCURRENCY = 4
// The periodic pass over every topic leaves room for what the reader asks for.
const BACKGROUND_CONCURRENCY = 2
const BACKGROUND_INTERVAL_MS = CACHE_TTL_MS

// What a profile turned off: its hidden sources and topics, and its muted words.
export interface ReaderFilter {
  hiddenSources: string[]
  hiddenTopics: string[]
  mutedWords: string[]
}

export const NO_FILTER: ReaderFilter = { hiddenSources: [], hiddenTopics: [], mutedWords: [] }

// The filter in a profile's stored preferences.
export const readerFilterOf = (preferences: Record<string, unknown> | null): ReaderFilter => {
  const strings = (value: unknown) =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
  return {
    hiddenSources: strings(preferences?.hiddenSources),
    hiddenTopics: strings(preferences?.hiddenTopics),
    mutedWords: strings(preferences?.mutedWords)
  }
}

// The reader's filter as one test: true for an article the profile does not want to see.
const filtered = ({ hiddenSources, mutedWords }: ReaderFilter) => {
  const muted = mutedWords.map(wordPattern)
  return (item: Pick<FeedItem, 'sourceId' | 'title' | 'summary'>) =>
    hiddenSources.includes(item.sourceId) ||
    (muted.length > 0 && muted.some(pattern => pattern.test(foldText(`${item.title} ${item.summary}`))))
}

export interface AiUsage {
  // False without an API key: no AI at all.
  available: boolean
  // used and limit: the profile's; householdUsed and householdLimit: everyone's together.
  kinds: { kind: AiCallKind; used: number; limit: number; householdUsed: number; householdLimit: number }[]
  // Every profile's calls: all kinds together, then kind by kind against its own caps.
  profiles: { profileId: number; calls: number; kinds: { kind: AiCallKind; used: number; limit: number }[] }[]
}

// A YouTube feed opens its channel or playlist; other feeds, the home page of their site.
export const siteOf = (source: Source) => {
  const feed = new URL(source.url)
  const channel = feed.searchParams.get('channel_id')
  const playlist = feed.searchParams.get('playlist_id')
  if (feed.hostname.endsWith('youtube.com') && channel) return `https://www.youtube.com/channel/${channel}`
  if (feed.hostname.endsWith('youtube.com') && playlist) return `https://www.youtube.com/playlist?list=${playlist}`
  return source.domains[0] ? `https://${source.domains[0]}/` : `${feed.origin}/`
}

export interface SourceStatus {
  id: string
  name: string
  kind: Source['kind']
  lang: Source['lang']
  // The site or channel to visit, for the round link in the list.
  site: string
  ok: boolean
  itemCount: number
  fetchedAt: string | null
  error: string | null
  // Added from a link by this profile; missing for the starting list's.
  addedBy?: number
}

// reader: opens in the reader. link: summary only, read on the site (source with reader: false).
export type Access = 'reader' | 'link'

// The same story from another source, shown with the article instead of as its own card.
export interface RelatedItem {
  id: string
  sourceId: string
  sourceName: string
  title: string
  link: string
  access: Access
  // Its own picture and reading time, for its card under the article.
  image: string | null
  readingMinutes: number | null
}

// readingMinutes and author: null until the article is read, and for articles read on the site.
export type TopicItem = FeedItem & {
  access: Access
  related: RelatedItem[]
  readingMinutes: number | null
  author: string | null
  // A 16-pixel picture shown blurred while the card's picture loads, once the server made it (article-images.ts).
  imagePreview?: string | null
}

export interface TopicFeed {
  id: string
  label: string
  items: TopicItem[]
  // Items still being checked in the background: they appear once readable.
  checking: number
  // More articles wait after the requested limit.
  hasMore: boolean
  sources: SourceStatus[]
}

export interface FrontPageSection {
  id: string
  label: string
  items: TopicItem[]
  checking: number
}

export interface FrontPage {
  sections: FrontPageSection[]
}

export type SearchItem = TopicItem & { topicId: string; topicLabel: string }

export interface SearchResult {
  items: SearchItem[]
  // Matching articles being checked: searching again soon may find them.
  checking: number
}

// "Le fil": one day of every topic, newest first.
export interface DayFeed {
  // YYYY-MM-DD, in the reader's time zone.
  day: string
  items: SearchItem[]
  checking: number
  // The closest earlier day with articles, for "Charger plus"; null when there is none.
  previousDay: string | null
}

export interface ListenSectionFeed {
  id: string
  label: string
  items: FeedItem[]
}

export interface ListenFeed {
  sections: ListenSectionFeed[]
  sources: SourceStatus[]
}

export type ArticleResult =
  | { status: 'unknown' }
  | { status: 'failed'; item: FeedItem }
  | { status: 'unreadable'; item: FeedItem }
  | { status: 'ok'; item: FeedItem; article: ExtractedArticle }

// unavailable: no API key configured. limited: the daily cap is reached.
export type SummaryResult =
  | { status: 'ok'; points: string[] }
  | { status: 'unavailable' | 'unknown' | 'unreadable' | 'failed' | 'refused' | 'limited' }

// none: no daily summary written lately. pending: the front page is still filling up, ask again shortly.
export type DailySummaryResult =
  | { status: 'ok'; points: DailySummaryPoint[]; generatedAt: string }
  | { status: 'unavailable' | 'none' | 'pending' | 'failed' | 'refused' | 'limited' }

export type DailySummaryPoint = WrittenPoint & { topicId: string | null }

export type AnswerResult =
  | { status: 'ok'; answer: string; sources: AnswerSource[] }
  | { status: 'unavailable' | 'unknown' | 'unreadable' | 'failed' | 'refused' | 'limited' }

interface SummaryEntry {
  expiresAt: number
  result: Promise<SummaryResult>
}

interface SourceEntry {
  startedAt: number
  expiresAt: number
  pending: Promise<void>
  items: FeedItem[]
  // Full article HTML from the feed, by item id, for sites that block article pages.
  contents: Map<string, string>
  fetchedAt: number | null
  error: string | null
}

interface ArticleEntry {
  expiresAt: number
  result: Promise<ArticleResult>
  // The site did not answer: the article is checked again once the entry expires.
  failed: boolean
}

export type SourceSuggestionResult =
  { status: 'ok'; sites: SuggestedSite[] } | { status: 'unavailable' | 'not_found' | 'limited' | 'refused' | 'failed' }

// The AI's tasks, all from the same provider and key.
export interface AiTools {
  summarize: Summarize
  writeDailySummary: WriteDailySummary
  answerQuestion: AnswerQuestion
  suggestSources: SuggestSources
}

export interface NewsServiceOptions {
  fetchText: FetchText
  // Absent when no API key is configured: the app then offers no summaries.
  summarize?: Summarize
  writeDailySummary?: WriteDailySummary
  answerQuestion?: AnswerQuestion
  suggestSources?: SuggestSources
  // Absent in tests: videos then show no length.
  fetchVideoDuration?: FetchVideoDuration
  // Absent in most tests: everything then lives in memory only.
  store?: NewsStore
  // Sources nobody reads (every profile turned them off): their feeds are not fetched.
  isPaused?: (sourceId: string) => boolean
  // The household's profiles, between which the AI caps are shared. Absent in tests: one profile has it all.
  profiles?: () => CapProfile[]
  // Daily caps on API calls for the household, AI_CAPS by default.
  aiCaps?: AiCaps
  // Where "today" is for the Résumé du jour: the server's own time zone by default.
  timeZone?: string
  // The language the AI writes in for a profile: its own, else the household's. French in tests by default.
  languageOf?: (profileId: number) => Language
  // The household's language: suggested sites are in it too when a profile reads another one.
  householdLanguage?: () => Language
  now?: () => number
  log?: (message: string) => void
}

const byNewest = (a: FeedItem, b: FeedItem) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '')

// The same article twice in a source's feeds. Other sources on the same story are grouped instead.
const dedupe = (items: FeedItem[]) => {
  const seen = new Set<string>()

  return items.filter(item => {
    const keys = [item.id, `${item.sourceId} ${titleKey(item.title)}`]
    if (keys.some(key => seen.has(key))) return false
    keys.forEach(key => seen.add(key))
    return true
  })
}

// Case and accents aside: "elections" finds "Élections".
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

export class NewsService {
  readonly #catalog: Catalog
  readonly #fetchText: FetchText
  readonly #fetchVideoDuration: FetchVideoDuration | undefined
  // Videos whose length is being read, one page at a time.
  readonly #durationQueue = new Set<string>()
  #readingDurations = false
  // Swapped by setAi when the admin changes the household's AI.
  #summarize: Summarize | undefined
  #writeDailySummary: WriteDailySummary | undefined
  #answerQuestion: AnswerQuestion | undefined
  #suggestSources: SuggestSources | undefined
  // Each profile's last Résumé du jour, and the one being written.
  readonly #dailySummaries = new Map<
    number,
    { createdAt: number; language: Language; dailySummary: { points: DailySummaryPoint[]; generatedAt: string } }
  >()
  readonly #dailySummaryPending = new Map<number, Promise<DailySummaryResult>>()
  readonly #now: () => number
  #trendTitles: { at: number; titles: { title: string; topicId: string; sourceId: string; summary: string }[] } | null =
    null
  readonly #log: (message: string) => void
  readonly #store: NewsStore | undefined
  #previewOf: (itemId: string) => string | null = () => null
  readonly #isPaused: (sourceId: string) => boolean
  readonly #profiles: () => CapProfile[]
  readonly #aiCaps: AiCaps
  readonly #languageOf: (profileId: number) => Language
  readonly #householdLanguage: () => Language
  #timeZone: string
  readonly #sources = new Map<string, SourceEntry>()
  readonly #articles = new Map<string, ArticleEntry>()
  readonly #summaries = new Map<string, SummaryEntry>()
  // The calls to the API of the last day, by whom.
  #aiCalls: AiCall[] = []
  // Item id -> whether the article opens in the reader.
  readonly #verdicts = new Map<string, Verdict>()
  readonly #checkQueue: string[] = []
  // Checks of the periodic pass, started only when nothing the reader asked for waits.
  readonly #backgroundQueue: string[] = []
  readonly #queued = new Set<string>()
  #activeChecks = 0
  #backgroundTimer: NodeJS.Timeout | null = null
  // What the current periodic pass has checked so far, logged when it is done.
  #pass: {
    startedAt: number
    listing: boolean
    checked: number
    extracted: number
    extractMs: number
    slowestMs: number
  } | null = null
  #idleWaiters: (() => void)[] = []

  constructor(
    catalog: Catalog,
    {
      fetchText,
      fetchVideoDuration,
      summarize,
      writeDailySummary,
      answerQuestion,
      suggestSources,
      store,
      isPaused = () => false,
      profiles = () => [{ id: DEFAULT_PROFILE_ID, admin: true }],
      aiCaps = AI_CAPS,
      timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
      languageOf = () => 'fr',
      householdLanguage = () => 'fr',
      now = Date.now,
      log = console.warn
    }: NewsServiceOptions
  ) {
    this.#catalog = catalog
    this.#fetchText = fetchText
    this.#fetchVideoDuration = fetchVideoDuration
    this.#summarize = summarize
    this.#writeDailySummary = writeDailySummary
    this.#answerQuestion = answerQuestion
    this.#suggestSources = suggestSources
    this.#now = now
    this.#log = log
    this.#store = store
    this.#isPaused = isPaused
    this.#profiles = profiles
    this.#aiCaps = aiCaps
    this.#timeZone = timeZone
    this.#languageOf = languageOf
    this.#householdLanguage = householdLanguage

    // The daily caps and the last daily summary survive a restart.
    if (store) {
      this.#aiCalls = store.aiCalls(now() - DAY_MS)
      for (const [profileId, dailySummary] of store.latestDailySummaries<DailySummaryPoint>()) {
        this.#dailySummaries.set(profileId, {
          createdAt: dailySummary.createdAt,
          language: dailySummary.language,
          dailySummary: { points: dailySummary.points, generatedAt: dailySummary.generatedAt }
        })
      }
    }
  }

  // Articles each source listed since then ("Peu ouvertes").
  articleCountsBySource(since: number): Map<string, number> {
    return this.#store?.articleCountsBySource(new Date(since).toISOString()) ?? new Map()
  }

  // Calls to the API in the last 24 hours, against each daily cap: the settings' "IA et crédits".
  // A new key, provider or region from Réglages, or none (the AI's buttons go away).
  setAi(tools: AiTools | null) {
    this.#summarize = tools?.summarize
    this.#writeDailySummary = tools?.writeDailySummary
    this.#answerQuestion = tools?.answerQuestion
    this.#suggestSources = tools?.suggestSources
  }

  setTimeZone(timeZone: string) {
    this.#timeZone = timeZone
  }

  // The blurred previews of the pictures the server made smaller (article-images.ts).
  setImagePreviews(previewOf: (itemId: string) => string | null) {
    this.#previewOf = previewOf
  }

  aiUsage(profileId = DEFAULT_PROFILE_ID): AiUsage {
    const calls = this.#recentAiCalls(this.#now())
    const kinds = AI_KINDS.map(kind => ({
      kind,
      used: this.#profileUsed(calls, kind, profileId),
      limit: this.#profileCap(kind, profileId),
      householdUsed: this.#householdUsed(calls, kind),
      householdLimit: this.#aiCaps[kind]
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
    return { available: this.#summarize !== undefined, kinds, profiles }
  }

  // "Remettre à 0" (the admin's): one kind or all. For the household, the calls count for no one any more; for a
  // profile, they no longer count for it, but the household keeps its real total.
  resetAiUsage({ kind = null, profileId = null }: { kind?: AiCallKind | null; profileId?: number | null }) {
    const now = this.#now()
    const level: AiCleared = profileId === null ? 'all' : 'profile'
    for (const call of this.#recentAiCalls(now)) {
      if ((kind !== null && call.kind !== kind) || (profileId !== null && call.profileId !== profileId)) continue
      if (call.cleared !== 'all') call.cleared = level
    }
    this.#store?.clearAiCalls(now - DAY_MS, level, kind, profileId)
  }

  #profileUsed(calls: AiCall[], kind: AiCallKind, profileId: number) {
    return calls.filter(call => call.kind === kind && call.profileId === profileId && call.cleared === undefined).length
  }

  #householdUsed(calls: AiCall[], kind: AiCallKind) {
    return calls.filter(call => call.kind === kind && call.cleared !== 'all').length
  }

  #profileCap(kind: AiCallKind, profileId: number) {
    return profileCap(this.#aiCaps[kind], this.#profiles(), profileId)
  }

  #recentAiCalls(now: number) {
    this.#aiCalls = this.#aiCalls.filter(call => call.at > now - DAY_MS)
    return this.#aiCalls
  }

  // Records a call to the API when both the household and the profile are under the day's cap; false otherwise.
  // The caps count it even across a restart.
  #takeAiCall(kind: AiCallKind, profileId: number, at: number) {
    const calls = this.#recentAiCalls(at)
    if (this.#householdUsed(calls, kind) >= this.#aiCaps[kind]) return false
    if (this.#profileUsed(calls, kind, profileId) >= this.#profileCap(kind, profileId)) return false
    const call = { kind, at, profileId }
    this.#aiCalls.push(call)
    this.#store?.recordAiCall(call)
    return true
  }

  // Articles the store still knows but the feeds no longer list, with their verdicts.
  #storedItems(sources: Source[], since: string, until: string | null = null): FeedItem[] {
    if (!this.#store) return []

    return this.#store
      .listItems(
        sources.map(source => source.id),
        since,
        until
      )
      .map(stored => this.#adoptStored(stored))
  }

  #adoptStored({ item, verdict }: StoredItem) {
    if (verdict && !this.#verdicts.has(item.id)) this.#rememberVerdict(item.id, verdict)
    return item
  }

  // The topic that lists a source first: where its articles show in search results and "Le fil".
  #topicOf(sourceId: string) {
    return this.#catalog.topics.find(topic => topic.sources.some(source => source.id === sourceId)) ?? null
  }

  #sectionOf(sourceId: string) {
    return this.#catalog.listen.find(section => section.sources.some(source => source.id === sourceId)) ?? null
  }

  get catalog() {
    return this.#catalog
  }

  // A source added: listed with its topics (or its section of "Vidéos") from now on. False when one is unknown.
  addSource(source: Source, section: 'topic' | 'listen', sectionIds: string[]) {
    const groups: { id: string; sources: Source[] }[] =
      section === 'topic' ? this.#catalog.topics : this.#catalog.listen
    const targets = sectionIds.map(id => groups.find(candidate => candidate.id === id))
    if (targets.length === 0 || targets.some(target => !target) || (section === 'listen' && targets.length > 1)) {
      return false
    }
    targets.forEach(target => target!.sources.push(source))
    this.#trendTitles = null
    return true
  }

  // A source moved to other topics: the first one labels its articles. False when one is unknown.
  setSourceTopics(sourceId: string, topicIds: string[]) {
    const source = this.#catalog.topics.flatMap(topic => topic.sources).find(candidate => candidate.id === sourceId)
    const topics = topicIds.map(id => this.#catalog.topics.find(topic => topic.id === id))
    if (!source || topics.length === 0 || topics.some(topic => !topic)) return false
    for (const topic of this.#catalog.topics) {
      topic.sources = topic.sources.filter(candidate => candidate.id !== sourceId)
    }
    // The first topic first: #topicOf finds it there.
    const [first, ...rest] = topics as Topic[]
    first!.sources.unshift(source)
    rest.forEach(topic => topic.sources.push(source))
    this.#trendTitles = null
    return true
  }

  removeSource(sourceId: string) {
    for (const group of [...this.#catalog.topics, ...this.#catalog.listen]) {
      group.sources = group.sources.filter(source => source.id !== sourceId)
    }
    this.#sources.delete(sourceId)
    this.#trendTitles = null
  }

  // The language the profile reads Hodi in: the AI writes in it, and topic names are given in it.
  languageOf(profileId: number) {
    return this.#languageOf(profileId)
  }

  get canSummarize() {
    return this.#summarize !== undefined
  }

  // fresh: fetch the feeds again unless they were fetched less than a minute ago.
  // background: unknown articles wait behind those the reader is waiting for.
  async getTopic(
    topicId: string,
    limit = TOPIC_PAGE_SIZE,
    { fresh = false, background = false, language = 'fr' as Language } = {}
  ): Promise<TopicFeed | null> {
    const topic = this.#catalog.topics.find(candidate => candidate.id === topicId)

    if (!topic) return null

    const { items, checking, hasMore } = await this.#listTopic(topic, limit, { check: true, fresh, background })

    return {
      id: topic.id,
      label: labelIn(topic, language),
      items,
      checking,
      hasMore,
      sources: this.#statuses(topic.sources)
    }
  }

  // Articles of every topic whose title or summary holds all the words (at a word start), newest first.
  // Matching articles not checked yet are checked now (a few at most): they show up on the next search.
  async search(query: string, language: Language = 'fr'): Promise<SearchResult> {
    const words = query.split(/\s+/).filter(Boolean)

    if (words.length === 0) return { items: [], checking: 0 }

    // The whole query as written ("GTA 6" also finds "GTA VI"), or each of its words anywhere.
    const patterns = [wordPattern(query)]
    const wordPatterns = words.map(wordPattern)
    const matches = (texts: string[]) => {
      const text = foldText(texts.join(' '))
      return patterns.some(pattern => pattern.test(text)) || wordPatterns.every(pattern => pattern.test(text))
    }
    const lists = await Promise.all(
      this.#catalog.topics.map(async topic => {
        const listed = await this.#listTopic(topic, MAX_TOPIC_LIMIT, { check: false })
        return {
          ...listed,
          items: listed.items.map(item => ({ ...item, topicId: topic.id, topicLabel: labelIn(topic, language) }))
        }
      })
    )
    const seen = new Set<string>()
    const items = lists
      .flatMap(list => list.items)
      .filter(item => {
        if (
          seen.has(item.id) ||
          !matches([item.sourceName, item.title, item.summary, ...item.related.map(related => related.title)])
        ) {
          return false
        }
        seen.add(item.id)
        return true
      })
      .sort(byNewest)
      .slice(0, MAX_SEARCH_RESULTS)
    const listed = lists.flatMap(list => list.items)
    listed.forEach(item => item.related.forEach(related => seen.add(related.id)))
    // Older articles, gone from the topics' window, that the store still knows. Words naming a source ("RFI climat")
    // look for the other words in that source's articles.
    const sources = allSources(this.#catalog)
    const namesSource = (word: string) => sources.some(source => wordPattern(word).test(foldText(source.name)))
    const named = sources.filter(source => words.some(word => wordPattern(word).test(foldText(source.name))))
    const rest = words.filter(word => !namesSource(word))
    const stored = [
      ...(this.#store?.search(
        words,
        sources.map(source => source.id),
        MAX_STORED_SEARCH_ROWS
      ) ?? []),
      ...(named.length > 0 && rest.length > 0
        ? (this.#store?.search(
            rest,
            named.map(source => source.id),
            MAX_STORED_SEARCH_ROWS
          ) ?? [])
        : [])
    ]
    const older = stored.flatMap((row): SearchItem[] => {
      const item = this.#adoptStored(row)
      const topic = this.#topicOf(item.sourceId)
      const source = topic?.sources.find(candidate => candidate.id === item.sourceId)
      const listedItem = source && this.#listedItem(item, source)
      if (!topic || !listedItem || seen.has(item.id) || !matches([item.sourceName, item.title, item.summary])) return []
      seen.add(item.id)
      return [{ ...listedItem, topicId: topic.id, topicLabel: labelIn(topic, language) }]
    })
    const toCheck = [...new Set(lists.flatMap(list => list.unchecked))]
      .filter(item => matches([item.sourceName, item.title, item.summary]))
      .slice(0, MAX_SEARCH_CHECKS)

    toCheck.forEach(item => this.#queueCheck(item.id))

    return { items: [...items, ...older].sort(byNewest).slice(0, MAX_SEARCH_RESULTS), checking: toCheck.length }
  }

  // "Historique": the articles and videos with these ids that the feeds or the store still know, in that order.
  // Read once, they stay listed even when they would be hidden from a topic now.
  history(ids: string[], language: Language = 'fr'): SearchItem[] {
    const items = ids.flatMap(id => {
      const found = this.#findItem(id)
      // A video or an episode has no topic: its Vidéos section stands for one.
      const topic = found && (this.#topicOf(found.item.sourceId) ?? this.#sectionOf(found.item.sourceId))
      if (!found || !topic) return []
      const item = this.#listedItem(found.item, found.source) ?? {
        ...found.item,
        access: 'reader' as const,
        related: [],
        readingMinutes: null,
        author: null
      }
      return [{ ...item, topicId: topic.id, topicLabel: labelIn(topic, language) }]
    })
    // Seen videos show their length, as in Vidéos.
    return this.#withDurations([{ items }])[0]?.items ?? items
  }

  // The phrases most titles of the last 48 hours share, for the search page. Feeds are not fetched for it.
  // The day's most covered subjects, without what the profile turned off.
  async getTrends(filter: ReaderFilter = NO_FILTER): Promise<Trend[]> {
    const now = this.#now()
    if (!this.#trendTitles || now - this.#trendTitles.at >= TRENDS_TTL_MS) {
      const since = new Date(now - TRENDS_WINDOW_MS).toISOString()
      const lists = await Promise.all(
        this.#catalog.topics.map(async topic => ({
          topic,
          listed: await this.#listTopic(topic, MAX_TOPIC_LIMIT, { check: false })
        }))
      )
      const seen = new Set<string>()
      const titles = lists.flatMap(({ topic, listed }) =>
        listed.items
          .filter(item => item.publishedAt !== null && item.publishedAt >= since)
          .flatMap(item => [item, ...item.related.map(related => ({ ...related, summary: '' }))])
          .filter(item => !seen.has(item.id) && seen.add(item.id))
          .map(item => ({ title: item.title, topicId: topic.id, sourceId: item.sourceId ?? '', summary: item.summary }))
      )
      this.#trendTitles = { at: now, titles }
    }
    const hidden = filtered(filter)
    return trendsOf(
      this.#trendTitles.titles.filter(entry => !filter.hiddenTopics.includes(entry.topicId) && !hidden(entry))
    )
  }

  // "Le fil": every topic's articles of one day (today when none is given), in the reader's time zone,
  // or one topic's only. An empty day is skipped for the next one with articles, unless articles of it are
  // still being checked. null: no such day or topic.
  async getDay(
    day: string | null,
    timeZone: string,
    topicId: string | null = null,
    language: Language = 'fr'
  ): Promise<DayFeed | null> {
    const topics = topicId === null ? this.#catalog.topics : this.#catalog.topics.filter(topic => topic.id === topicId)
    if (topics.length === 0) return null
    const today = dayOf(this.#now(), timeZone)
    let current = day ?? today
    if (current > today) return null

    for (let skipped = 0; ; skipped++) {
      const range = dayRange(current, timeZone)
      if (!range) return null
      const feed = await this.#listDay(topics, range, current === today, timeZone, language)
      if (feed.items.length > 0 || feed.checking > 0 || !feed.previousDay || skipped >= MAX_EMPTY_DAYS) return feed
      current = feed.previousDay
    }
  }

  async #listDay(
    topics: Topic[],
    range: DayRange,
    isToday: boolean,
    timeZone: string,
    language: Language
  ): Promise<DayFeed> {
    const lists = await Promise.all(
      topics.map(async topic => {
        const listed = await this.#listTopic(topic, MAX_TOPIC_LIMIT, {
          check: true,
          window: { since: range.start, until: isToday ? null : range.end }
        })
        return {
          ...listed,
          items: listed.items.map(item => ({ ...item, topicId: topic.id, topicLabel: labelIn(topic, language) }))
        }
      })
    )
    const seen = new Set<string>()
    const items = lists
      .flatMap(list => list.items)
      .filter(item => !seen.has(item.id) && seen.add(item.id))
      .sort(byNewest)

    const sources = topics.flatMap(topic => topic.sources)
    const inMemory = sources
      .flatMap(source => this.#sources.get(source.id)?.items ?? [])
      .reduce<string | null>(
        (latest, item) =>
          item.publishedAt !== null && item.publishedAt < range.start && (latest === null || item.publishedAt > latest)
            ? item.publishedAt
            : latest,
        null
      )
    const stored = this.#store?.latestBefore([...new Set(sources.map(source => source.id))], range.start) ?? null
    const latest = [inMemory, stored]
      .filter(date => date !== null)
      .sort()
      .at(-1)

    return {
      day: range.day,
      items,
      checking: lists.reduce((total, list) => total + list.checking, 0),
      previousDay: latest ? dayOf(Date.parse(latest), timeZone) : null
    }
  }

  // check: queue unknown articles for a readability check, and count them as being checked.
  // Otherwise they are returned as unchecked. fresh: fetch the feeds again (see getTopic).
  // window: the dates listed, the last 72 hours by default. Undated articles count as new, so are listed
  // only when the window reaches now (until null).
  async #listTopic(
    topic: Topic,
    limit: number,
    {
      check,
      fresh = false,
      background = false,
      window = { since: new Date(this.#now() - TOPIC_WINDOW_MS).toISOString(), until: null }
    }: { check: boolean; fresh?: boolean; background?: boolean; window?: { since: string; until: string | null } }
  ) {
    const entries = await this.#refreshAll(topic.sources, fresh)
    const { since, until } = window
    const fromFeeds = entries.flatMap(entry => entry.items)
    const candidates = dedupe([...fromFeeds, ...this.#storedItems(topic.sources, since, until)].sort(byNewest)).filter(
      item =>
        item.publishedAt === null
          ? until === null
          : item.publishedAt >= since && (until === null || item.publishedAt < until)
    )
    const sources = new Map(topic.sources.map(source => [source.id, source]))
    const items: TopicItem[] = []
    const unchecked: FeedItem[] = []
    const now = this.#now()
    let checking = 0
    let hasMore = false

    // The newest article of a story gets the card; other sources on it are listed with it.
    const list = (item: TopicItem) => {
      const story = items.find(
        listed =>
          listed.sourceId !== item.sourceId &&
          !listed.related.some(related => related.sourceName === item.sourceName) &&
          sameStory(listed, item)
      )

      if (!story) {
        items.push(item)
        return
      }

      const { id, sourceId, sourceName, title, link, access, image, readingMinutes } = item
      story.related.push({ id, sourceId, sourceName, title, link, access, image, readingMinutes })
      story.image ??= item.image
    }

    // Only articles that open in the reader are listed; unknown ones are checked in the background.
    for (const item of candidates) {
      if (items.length >= limit) {
        hasMore = true
        break
      }

      const source = sources.get(item.sourceId)
      if (source && isSkipped(source, item.link)) continue
      const listed = source && this.#listedItem(item, source)
      if (listed) {
        list(listed)
        continue
      }

      const verdict = this.#verdicts.get(item.id)

      if (verdict === undefined) {
        const article = this.#articles.get(item.id)
        if (article?.failed && article.expiresAt > now) continue

        if (!check) {
          unchecked.push(item)
          continue
        }

        checking++
        this.#queueCheck(item.id, background)
      }
    }

    return { items, checking, hasMore, unchecked }
  }

  // The item as its card shows it, or null when it is not to be listed (yet): unreadable, or not checked.
  #listedItem(item: FeedItem, source: Source): TopicItem | null {
    if (isSkipped(source, item.link)) return null
    const imagePreview = this.#previewOf(item.id)
    if (source.reader === false)
      return { ...item, access: 'link', related: [], readingMinutes: null, author: null, imagePreview }

    const verdict = this.#verdicts.get(item.id)
    if (!verdict?.readable) return null

    // RTL info only pastes page chrome in its feed: the article page has the real image.
    return {
      ...item,
      image: item.image ?? verdict.image,
      access: 'reader',
      related: [],
      readingMinutes: verdict.minutes,
      author: verdict.author,
      imagePreview
    }
  }

  // "À la une": the most covered stories of each topic, from the last day when there are enough.
  // filter: the profile's, so that a story it would not see leaves its place to another.
  // known: the profile's seen stories and read articles. A story it already knows, by any of its articles,
  // makes room for the next one; it comes back only when the topic has nothing newer.
  async getFrontPage(
    filter: ReaderFilter = NO_FILTER,
    known: ReadonlySet<string> = new Set(),
    language: Language = 'fr'
  ): Promise<FrontPage> {
    const recent = new Date(this.#now() - FRONT_PAGE_WINDOW_MS).toISOString()
    const hidden = filtered(filter)
    const isKnown = (item: TopicItem) => known.has(item.id) || item.related.some(other => known.has(other.id))
    // A topic without a source the profile reads has nothing to put forward.
    const shown = this.#catalog.topics.filter(topic =>
      topic.sources.some(source => !filter.hiddenSources.includes(source.id))
    )
    const sections = await Promise.all(
      shown.map(async topic => {
        // Same listing as the topic itself: unknown articles are checked in the background.
        const listed = (await this.getTopic(topic.id)) ?? { items: [], checking: 0 }
        const { checking } = listed
        const items = listed.items.filter(item => !hidden(item))
        const fresh = items.filter(item => item.publishedAt !== null && item.publishedAt >= recent)
        // More sources on a story means a bigger story; the newest first among equals.
        const ranked = (fresh.length >= FRONT_PAGE_SIZE ? fresh : items)
          .map((item, index) => ({ item, index }))
          .sort((a, b) => b.item.related.length - a.item.related.length || a.index - b.index)
          .map(({ item }) => item)
        const top = [...ranked.filter(item => !isKnown(item)), ...ranked.filter(isKnown)].slice(0, FRONT_PAGE_SIZE)

        return { id: topic.id, label: labelIn(topic, language), items: top, checking }
      })
    )

    return { sections }
  }

  // "Suggérer des sources" for a topic: one call to the API, within its daily cap. The sites still need
  // a feed and readable articles before they are offered (see source-routes.ts).
  async suggestSources(
    topicId: string,
    profileId: number,
    { current, replacing }: { current: string[]; replacing: string | null }
  ): Promise<SourceSuggestionResult> {
    const suggest = this.#suggestSources
    if (!suggest) return { status: 'unavailable' }
    const topic = this.#catalog.topics.find(candidate => candidate.id === topicId)
    if (!topic) return { status: 'not_found' }
    if (!this.#takeAiCall('sources', profileId, this.#now())) return { status: 'limited' }
    try {
      const language = this.#languageOf(profileId)
      const languages = [...new Set([language, this.#householdLanguage()])]
      return {
        status: 'ok',
        sites: await suggest({ topic: labelIn(topic, language), current, replacing, language, languages })
      }
    } catch (error) {
      if (error instanceof SummaryRefusedError) return { status: 'refused' }
      this.#log(`Source suggestions for ${topicId} failed: ${errorMessage(error)}`)
      return { status: 'failed' }
    }
  }

  // Questions are not cached: each one is asked of the API, within a daily cap.
  async answerQuestion(itemId: string, question: string, profileId = DEFAULT_PROFILE_ID): Promise<AnswerResult> {
    const answer = this.#answerQuestion
    if (!answer) return { status: 'unavailable' }

    const loaded = await this.getArticle(itemId)
    if (loaded.status !== 'ok') return { status: loaded.status }

    const now = this.#now()
    if (!this.#takeAiCall('question', profileId, now)) return { status: 'limited' }

    const { item, article } = loaded

    try {
      const answered = await answer({
        title: item.title,
        sourceName: item.sourceName,
        contentHtml: article.contentHtml,
        question,
        language: this.#languageOf(profileId)
      })
      return { status: 'ok', ...answered }
    } catch (error) {
      if (error instanceof SummaryRefusedError) return { status: 'refused' }
      this.#log(`Question on ${item.link} failed: ${errorMessage(error)}`)
      return { status: 'failed' }
    }
  }

  // "Le Résumé du jour": the day's news in a paragraph per topic, shared by every device. Reading it costs nothing.
  // One written in another language (the profile changed its own since) counts as none: it is written again on a click.
  getDailySummary(profileId = DEFAULT_PROFILE_ID): DailySummaryResult {
    if (!this.#writeDailySummary) return { status: 'unavailable' }

    const last = this.#todaysDailySummary(profileId, this.#now())
    return last ? { status: 'ok', ...last.dailySummary } : { status: 'none' }
  }

  // The profile's daily summary of today, in its current language.
  #todaysDailySummary(profileId: number, now: number) {
    const last = this.#dailySummaries.get(profileId)
    return last && sameDay(last.createdAt, now, this.#timeZone) && last.language === this.#languageOf(profileId)
      ? last
      : null
  }

  // Writes the daily summary from the front page; only ever on the reader's request, as it uses the API.
  // Each profile's own, from its sources and topics, without its muted words.
  async writeDailySummary(
    profileId = DEFAULT_PROFILE_ID,
    filter: ReaderFilter = NO_FILTER
  ): Promise<DailySummaryResult> {
    const write = this.#writeDailySummary
    if (!write) return { status: 'unavailable' }

    const now = this.#now()
    const language = this.#languageOf(profileId)
    const last = this.#todaysDailySummary(profileId, now)
    const lastResult = (): DailySummaryResult | null => (last ? { status: 'ok', ...last.dailySummary } : null)

    if (last && last.createdAt > now - DAILY_SUMMARY_MIN_AGE_MS) return lastResult()!
    const writing = this.#dailySummaryPending.get(profileId)
    if (writing) return writing

    const sections = (await this.getFrontPage(filter, new Set(), language)).sections.filter(
      section => !filter.hiddenTopics.includes(section.id)
    )
    const stories: DailySummaryStory[] = sections.flatMap(section =>
      section.items.map(item => ({
        topicId: section.id,
        topic: section.label,
        title: item.title,
        sourceName: item.sourceName,
        summary: item.summary,
        coverage: item.related.length + 1
      }))
    )
    const checking = sections.some(section => section.checking > 0)
    // A topic whose articles are still being checked would be left out of the daily summary.
    const topicWaiting = sections.some(section => section.checking > 0 && section.items.length === 0)

    if (stories.length === 0 || (checking && (stories.length < MIN_DAILY_SUMMARY_STORIES || topicWaiting)))
      return { status: 'pending' }

    // Another request may have started the daily summary while the front page loaded.
    const started = this.#dailySummaryPending.get(profileId)
    if (started) return started

    if (!this.#takeAiCall('dailySummary', profileId, now)) return lastResult() ?? { status: 'limited' }

    // In the front page's order, each point with its topic's id so the app can follow the reader's settings.
    const rank = (point: DailySummaryPoint) => {
      const index = sections.findIndex(section => section.id === point.topicId)
      return index === -1 ? sections.length : index
    }

    const pending = write(stories, language)
      .then(
        (written): DailySummaryResult => {
          const points = written
            .map(point => ({ ...point, topicId: sections.find(section => section.label === point.topic)?.id ?? null }))
            .sort((a, b) => rank(a) - rank(b))
          const dailySummary = { points, generatedAt: new Date(now).toISOString() }
          this.#dailySummaries.set(profileId, { createdAt: now, language, dailySummary })
          this.#store?.saveDailySummary({ ...dailySummary, createdAt: now, language }, profileId)
          return { status: 'ok', ...dailySummary }
        },
        (error: unknown): DailySummaryResult => {
          this.#log(`Daily summary failed: ${errorMessage(error)}`)
          // The last daily summary is better than nothing.
          return lastResult() ?? { status: error instanceof SummaryRefusedError ? 'refused' : 'failed' }
        }
      )
      .finally(() => {
        this.#dailySummaryPending.delete(profileId)
      })

    this.#dailySummaryPending.set(profileId, pending)
    return pending
  }

  // Every topic's feeds are fetched and their new articles checked every 15 minutes, so that "Suivis",
  // search and notifications see every article without the reader opening each topic first.
  startBackgroundChecks() {
    if (this.#backgroundTimer) return
    void this.checkAllTopics()
    this.#backgroundTimer = setInterval(() => void this.checkAllTopics(), BACKGROUND_INTERVAL_MS)
    this.#backgroundTimer.unref()
  }

  stopBackgroundChecks() {
    if (this.#backgroundTimer) clearInterval(this.#backgroundTimer)
    this.#backgroundTimer = null
  }

  // One pass: lists the whole window of every topic and queues what was never checked.
  async checkAllTopics() {
    const pass = (this.#pass ??= {
      startedAt: this.#now(),
      listing: true,
      checked: 0,
      extracted: 0,
      extractMs: 0,
      slowestMs: 0
    })
    pass.listing = true
    try {
      await Promise.all(
        this.#catalog.topics.map(topic => this.getTopic(topic.id, MAX_TOPIC_LIMIT, { background: true }))
      )
    } finally {
      pass.listing = false
      this.#endPassIfDone()
    }
  }

  // Resolves once every queued readability check has finished.
  whenChecksIdle() {
    if (this.#activeChecks === 0 && this.#checkQueue.length === 0 && this.#backgroundQueue.length === 0) {
      return Promise.resolve()
    }
    return new Promise<void>(resolve => this.#idleWaiters.push(resolve))
  }

  #queueCheck(itemId: string, background = false) {
    if (this.#queued.has(itemId)) {
      // The reader now waits for an article the periodic pass had queued: it goes first.
      const index = background ? -1 : this.#backgroundQueue.indexOf(itemId)
      if (index >= 0) {
        this.#backgroundQueue.splice(index, 1)
        this.#checkQueue.push(itemId)
        this.#pumpChecks()
      }
      return
    }

    this.#queued.add(itemId)
    ;(background ? this.#backgroundQueue : this.#checkQueue).push(itemId)
    this.#pumpChecks()
  }

  #pumpChecks() {
    for (;;) {
      const queue =
        this.#activeChecks < CHECK_CONCURRENCY && this.#checkQueue.length > 0
          ? this.#checkQueue
          : this.#activeChecks < BACKGROUND_CONCURRENCY && this.#backgroundQueue.length > 0
            ? this.#backgroundQueue
            : null
      if (!queue) break

      const itemId = queue.shift() as string
      const background = queue === this.#backgroundQueue
      this.#activeChecks++

      void this.getArticle(itemId).finally(() => {
        this.#activeChecks--
        this.#queued.delete(itemId)
        if (background && this.#pass) this.#pass.checked++
        this.#pumpChecks()
      })
    }

    if (this.#activeChecks === 0 && this.#checkQueue.length === 0 && this.#backgroundQueue.length === 0) {
      this.#idleWaiters.splice(0).forEach(resolve => resolve())
    }
    this.#endPassIfDone()
  }

  // Logs what the pass cost once its last check is done: the extraction time tells whether it needs its own thread.
  #endPassIfDone() {
    const pass = this.#pass
    if (!pass || pass.listing || this.#backgroundQueue.length > 0 || this.#activeChecks > 0) return

    this.#pass = null
    if (pass.checked === 0) return
    const seconds = Math.round((this.#now() - pass.startedAt) / 1000)
    const average = pass.extracted > 0 ? Math.round(pass.extractMs / pass.extracted) : 0
    this.#log(
      `Background checks: ${pass.checked} articles in ${seconds} s, extraction ${average} ms on average, ${Math.round(pass.slowestMs)} ms at most`
    )
  }

  #recordVerdict(itemId: string, verdict: Verdict) {
    this.#rememberVerdict(itemId, verdict)
    this.#store?.saveVerdict(itemId, verdict)
  }

  #rememberVerdict(itemId: string, verdict: Verdict) {
    this.#verdicts.delete(itemId)
    this.#verdicts.set(itemId, verdict)

    if (this.#verdicts.size > MAX_VERDICTS) {
      const oldest = this.#verdicts.keys().next().value
      if (oldest !== undefined) this.#verdicts.delete(oldest)
    }
  }

  // The videos and episodes of the last 60 days, newest first, grouped by section.
  async getListen(language: Language = 'fr'): Promise<ListenFeed> {
    const sources = listenSources(this.#catalog)

    await this.#refreshAll(sources)

    const oldest = new Date(this.#now() - LISTEN_WINDOW_MS).toISOString()
    const sections = this.#catalog.listen.map(section => ({
      id: section.id,
      label: labelIn(section, language),
      items: dedupe([
        ...section.sources.flatMap(source => this.#sources.get(source.id)?.items ?? []),
        ...this.#storedItems(section.sources, oldest)
      ])
        .filter(item => item.publishedAt === null || item.publishedAt >= oldest)
        .sort(byNewest)
    }))

    return { sections: this.#withDurations(sections), sources: this.#statuses(sources) }
  }

  // Each video with its length when known; the others are read in the background, for the next visit.
  // A Short that its feed didn't mark as one (a minute or less) leaves the list.
  #withDurations<T extends { items: FeedItem[] }>(sections: T[]): T[] {
    if (!this.#store || !this.#fetchVideoDuration) return sections

    const videoIds = sections.flatMap(section =>
      section.items.flatMap(item => (item.media?.type === 'youtube' ? [item.media.videoId] : []))
    )
    const known = this.#store.getVideoDurations([...new Set(videoIds)], this.#now() - DURATION_RETRY_MS)
    for (const id of videoIds) if (!known.has(id)) this.#durationQueue.add(id)
    void this.#readDurations()

    return sections.map(section => ({
      ...section,
      items: section.items.flatMap(item => {
        if (item.media?.type !== 'youtube') return [item]
        const seconds = known.get(item.media.videoId)
        if (seconds == null) return [item]
        if (seconds <= MAX_SHORT_SECONDS) return []
        return [{ ...item, media: { ...item.media, durationSeconds: seconds } }]
      })
    }))
  }

  async #readDurations() {
    if (this.#readingDurations || !this.#fetchVideoDuration || !this.#store) return
    this.#readingDurations = true
    try {
      for (const id of this.#durationQueue) {
        this.#durationQueue.delete(id)
        const seconds = await this.#fetchVideoDuration(id).catch((error: unknown) => {
          this.#log(`Video length ${id}: ${errorMessage(error)}`)
          return null
        })
        this.#store.saveVideoDuration(id, seconds, this.#now())
      }
    } finally {
      this.#readingDurations = false
    }
  }

  // Reports what the last fetches returned, without triggering new ones.
  getSourceStatuses() {
    return this.#statuses(allSources(this.#catalog))
  }

  async getArticle(itemId: string): Promise<ArticleResult> {
    const now = this.#now()

    for (const [id, entry] of this.#articles) {
      if (entry.expiresAt <= now) this.#articles.delete(id)
    }

    const cached = this.#articles.get(itemId)
    if (cached) return cached.result

    // Only items already listed by a configured feed can be fetched: no arbitrary URLs.
    const found = this.#findItem(itemId)
    if (!found) return { status: 'unknown' }

    // Extracted before: no need to fetch the page again.
    const stored = found.source.reader ? this.#store?.getContent(itemId) : null
    const loaded: Promise<ArticleResult> = stored
      ? // Cleaned again: the cleanup learns new site furniture after the text was stored.
        Promise.resolve({
          status: 'ok',
          item: found.item,
          article: { ...stored, contentHtml: cleanArticleHtml(stored.contentHtml) }
        })
      : this.#loadArticle(found.item, found.source, found.feedContent)
    // The text is stored as extracted; the site's repeated blocks are taken out each time it is served, so an
    // article read before its source had others to compare with is cleaned later too.
    const result = loaded.then(settled => this.#withoutSiteTemplate(settled, found.source.id, itemId))

    if (this.#articles.size >= MAX_CACHED_ARTICLES) {
      const oldest = this.#articles.keys().next().value
      if (oldest !== undefined) this.#articles.delete(oldest)
    }

    const entry: ArticleEntry = { expiresAt: now + CACHE_TTL_MS, result, failed: false }
    this.#articles.set(itemId, entry)

    const settled = await result

    // A network error is retried after a minute; the verdict waits for a real answer.
    if (settled.status === 'failed') {
      entry.expiresAt = this.#now() + ERROR_TTL_MS
      entry.failed = true
    } else if (!stored) {
      const article = settled.status === 'ok' ? settled.article : null
      this.#recordVerdict(itemId, {
        readable: article !== null,
        image: article?.image ?? null,
        minutes: article ? readingMinutes(article) : null,
        author: article ? articleAuthor(article) : null
      })
      const extracted = await loaded
      if (extracted.status === 'ok') this.#store?.saveContent(itemId, extracted.article, this.#now())
    }

    return settled
  }

  #withoutSiteTemplate(settled: ArticleResult, sourceId: string, itemId: string): ArticleResult {
    if (settled.status !== 'ok' || !this.#store) return settled
    const others = this.#store.getSourceContents(sourceId, itemId, TEMPLATE_SAMPLE)
    const contentHtml = removeSiteTemplate(settled.article.contentHtml, others)
    return contentHtml === settled.article.contentHtml
      ? settled
      : { ...settled, article: { ...settled.article, contentHtml } }
  }

  // The API is called once per article and language: later requests in that language share the same summary.
  async getSummary(itemId: string, profileId = DEFAULT_PROFILE_ID): Promise<SummaryResult> {
    const summarize = this.#summarize
    if (!summarize) return { status: 'unavailable' }

    const now = this.#now()
    const language = this.#languageOf(profileId)
    const key = `${itemId} ${language}`

    for (const [id, entry] of this.#summaries) {
      if (entry.expiresAt <= now) this.#summaries.delete(id)
    }

    const cached = this.#summaries.get(key)
    if (cached) return cached.result

    // Paid for once already: shown again for free.
    const storedPoints = this.#store?.getSummary(itemId, language)
    if (storedPoints) return { status: 'ok', points: storedPoints }

    const loaded = await this.getArticle(itemId)
    if (loaded.status !== 'ok') return { status: loaded.status }

    // Checked again: another request may have started the summary while the article loaded.
    const started = this.#summaries.get(key)
    if (started) return started.result

    if (!this.#takeAiCall('summary', profileId, now)) return { status: 'limited' }

    const { item, article } = loaded
    const input = { title: item.title, sourceName: item.sourceName, contentHtml: article.contentHtml, language }
    const result = summarize(input).then(
      (points): SummaryResult => {
        this.#store?.saveSummary(itemId, language, points, this.#now())
        return { status: 'ok', points }
      },
      (error: unknown): SummaryResult => {
        this.#summaries.delete(key)
        if (error instanceof SummaryRefusedError) return { status: 'refused' }
        this.#log(`Summary of ${item.link} failed: ${errorMessage(error)}`)
        return { status: 'failed' }
      }
    )

    if (this.#summaries.size >= MAX_CACHED_SUMMARIES) {
      const oldest = this.#summaries.keys().next().value
      if (oldest !== undefined) this.#summaries.delete(oldest)
    }

    this.#summaries.set(key, { expiresAt: now + SUMMARY_TTL_MS, result })

    return result
  }

  async #loadArticle(item: FeedItem, source: Source, storedFeedContent: string | null): Promise<ArticleResult> {
    if (item.kind !== 'article' || !source.reader) return { status: 'unreadable', item }

    const fromPage = await this.#loadArticlePage(item, source)
    if (fromPage.status === 'ok') return fromPage

    // Some sites block article pages but publish the full text in their feed.
    const feedContent = this.#sources.get(source.id)?.contents.get(item.id) ?? storedFeedContent
    const article = feedContent ? extractFeedContent(feedContent, item.link) : null

    return article ? { status: 'ok', item, article } : fromPage
  }

  async #loadArticlePage(item: FeedItem, source: Source): Promise<ArticleResult> {
    if (!isAllowedHost(source, new URL(item.link))) {
      return { status: 'unreadable', item }
    }

    try {
      const page = await this.#fetchText(item.link)

      // Redirects must not lead outside the source's domains.
      if (!isAllowedHost(source, new URL(page.url))) {
        return { status: 'unreadable', item }
      }

      const started = performance.now()
      const article = extractArticle(page.text, page.url)
      const elapsed = performance.now() - started
      if (this.#pass) {
        this.#pass.extracted++
        this.#pass.extractMs += elapsed
        this.#pass.slowestMs = Math.max(this.#pass.slowestMs, elapsed)
      }
      return article ? { status: 'ok', item, article } : { status: 'unreadable', item }
    } catch (error) {
      this.#log(`Article ${item.link} failed: ${errorMessage(error)}`)
      return { status: 'failed', item }
    }
  }

  #findItem(itemId: string): { item: FeedItem; source: Source; feedContent: string | null } | null {
    const sources = allSources(this.#catalog)

    for (const source of sources) {
      const item = this.#sources.get(source.id)?.items.find(candidate => candidate.id === itemId)
      if (item) return { item, source, feedContent: null }
    }

    // Gone from the feeds but stored: still one of a configured source's items, never an arbitrary URL.
    const stored = this.#store?.findItem(itemId)
    const source = stored && sources.find(candidate => candidate.id === stored.item.sourceId)
    return stored && source ? { item: stored.item, source, feedContent: stored.feedContent } : null
  }

  async #refreshAll(sources: Source[], fresh = false) {
    // A paused source keeps what it last had; it is fetched again once a profile turns it back on.
    await Promise.all(sources.filter(source => !this.#isPaused(source.id)).map(source => this.#refresh(source, fresh)))
    return sources.flatMap(source => this.#sources.get(source.id) ?? [])
  }

  #refresh(source: Source, fresh = false) {
    const existing = this.#sources.get(source.id)
    const now = this.#now()
    const recent = existing !== undefined && now - existing.startedAt < FORCED_REFRESH_MIN_MS

    if (existing && existing.expiresAt > now && (!fresh || recent)) {
      return existing.pending
    }

    // Keep the previous items while refreshing, and if the refresh fails.
    const entry: SourceEntry = {
      startedAt: now,
      expiresAt: now + CACHE_TTL_MS,
      pending: Promise.resolve(),
      items: existing?.items ?? [],
      contents: existing?.contents ?? new Map(),
      fetchedAt: existing?.fetchedAt ?? null,
      error: existing?.error ?? null
    }

    entry.pending = this.#fetchText(source.url)
      .then(({ text }) => {
        const entries = parseFeedEntries(text, source)
        this.#store?.saveFeedEntries(entries, this.#now())
        entry.items = entries.map(({ item }) => item)
        entry.contents = new Map(
          entries.flatMap(({ item, contentHtml }) => (contentHtml ? [[item.id, contentHtml] as const] : []))
        )
        entry.fetchedAt = this.#now()
        entry.error = null
      })
      .catch((error: unknown) => {
        entry.error = errorMessage(error)
        entry.expiresAt = this.#now() + ERROR_TTL_MS
        this.#log(`Feed ${source.id} failed: ${entry.error}`)
      })

    this.#sources.set(source.id, entry)
    return entry.pending
  }

  #statuses(sources: Source[]): SourceStatus[] {
    return sources.map(source => {
      const entry = this.#sources.get(source.id)

      return {
        id: source.id,
        name: source.name,
        kind: source.kind,
        lang: source.lang,
        site: siteOf(source),
        ok: entry !== undefined && entry.error === null && entry.fetchedAt !== null,
        itemCount: entry?.items.length ?? 0,
        fetchedAt: entry?.fetchedAt ? new Date(entry.fetchedAt).toISOString() : null,
        error: entry?.error ?? null,
        ...(source.addedBy === undefined ? {} : { addedBy: source.addedBy })
      }
    })
  }
}
