import type { AnswerSource, SuggestedSite } from './summarizer.ts'
import type { Catalog, Language, Source } from './catalog.ts'
import type { ExtractedArticle } from './extract.ts'
import type { FeedEntry, FeedItem } from './feed-parser.ts'
import type { ExtractPage } from './extract-pool.ts'
import type { FetchText } from './fetch-text.ts'
import type { WriteDailySummary, WrittenPoint } from './daily-summary.ts'
import type { AnswerQuestion, PluginQuestion, SuggestSources, Summarize } from './summarizer.ts'
import type { FetchVideoDuration } from './video-durations.ts'
import type { NewsStore } from '../db/news-store.ts'
import type { AiCaps, CapProfile } from './ai-ledger.ts'

// What NewsService answers, and what it is built with.
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

export type SourceSuggestionResult =
  { status: 'ok'; sites: SuggestedSite[] } | { status: 'unavailable' | 'not_found' | 'limited' | 'refused' | 'failed' }

// The AI's tasks, all from the same provider and key.
export interface AiTools {
  summarize: Summarize
  writeDailySummary: WriteDailySummary
  answerQuestion: AnswerQuestion
  suggestSources: SuggestSources
  // A plugin's question, after a click on its AiButton (plugins/ai.ts checks it first).
  askForPlugin?: (question: PluginQuestion) => Promise<string>
}

export type PluginAskResult =
  { status: 'ok'; text: string } | { status: 'unavailable' | 'limited' | 'refused' | 'failed' }

export interface NewsServiceOptions {
  fetchText: FetchText
  // Where an article page's text is extracted (extract-pool.ts); on the calling thread when absent.
  extractPage?: ExtractPage
  // A plugin's feed (plugins/feeds.ts): its articles, asked of the plugin in place of fetching an address.
  readPluginFeed?: (source: Source) => Promise<FeedEntry[]>
  // Each household's own sources, read the first time a request of that household asks (the first household's is
  // the catalogue given to the constructor), and every household, for the background pass.
  catalogOf?: () => Catalog
  households?: () => number[]
  // Each household's AI and time zone, read as the catalogue is; setAi and setTimeZone change the request's.
  aiOf?: () => AiTools | null
  timeZoneOf?: () => string
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
  // How many days an article stays in the lists and a video in Vidéos: Serveur › Contenu, 3 and 60 by default.
  windows?: () => { articleDays: number; videoDays: number }
  now?: () => number
  log?: (message: string) => void
}
