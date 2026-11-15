import { getJson } from './http.ts'

// News: topics, the front page, search, Le fil. Mirrors the server types in server/news.

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

export interface Article {
  title: string | null
  byline: string | null
  contentHtml: string
}

export type ArticleResult =
  | { status: 'ok'; item: FeedItem; article: Article; canSummarize?: boolean }
  | { status: 'unreadable' | 'failed'; item: FeedItem }
  | { status: 'not_found' }

export const getTopics = async () => (await getJson<{ topics: TopicInfo[] }>('/topics')).topics

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
