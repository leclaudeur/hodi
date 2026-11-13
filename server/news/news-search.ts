import type { Catalog, Language } from './catalog.ts'
import { allSources } from './catalog.ts'
import type { NewsStore } from '../db/news-store.ts'
import { type Trend, trendsOf } from './trends.ts'
import { foldText, wordPattern } from '../../shared/word-match.ts'
import { labelIn } from '../labels.ts'
import type { VideoLengths } from './video-lengths.ts'
import type { CheckQueue } from './check-queue.ts'
import type { ArticleLoader } from './article-loader.ts'
import { type ReaderFilter, filtered } from './reader-filter.ts'
import { MAX_TOPIC_LIMIT, type TopicLister, byNewest } from './topic-lister.ts'
import type { SearchItem, SearchResult } from './news-types.ts'
import { currentHouseholdId } from '../db/household-scope.ts'

// The search page: articles found by words, "Historique" and "Tendances · 48 h".

const MAX_SEARCH_RESULTS = 60
// Older articles the store finds for a search, before they are filtered like the feeds' ones.
const MAX_STORED_SEARCH_ROWS = 300
const MAX_SEARCH_CHECKS = 20
// "Tendances · 48 h": from the titles of the last two days, worked out again every ten minutes at most.
const TRENDS_WINDOW_MS = 48 * 60 * 60 * 1000
const TRENDS_TTL_MS = 10 * 60 * 1000

interface TrendTitle {
  title: string
  topicId: string
  sourceId: string
  summary: string
}

interface NewsSearchOptions {
  catalog: () => Catalog
  lister: TopicLister
  loader: ArticleLoader
  checks: CheckQueue
  store: NewsStore | undefined
  videoLengths: VideoLengths | null
  now: () => number
}

// The whole query as written ("GTA 6" also finds "GTA VI"), or each of its words anywhere.
const matcherOf = (query: string, words: string[]) => {
  const patterns = [wordPattern(query)]
  const wordPatterns = words.map(wordPattern)
  return (texts: string[]) => {
    const text = foldText(texts.join(' '))
    return patterns.some(pattern => pattern.test(text)) || wordPatterns.every(pattern => pattern.test(text))
  }
}

export class NewsSearch {
  readonly #options: NewsSearchOptions
  // Each household's titles of the last hours, for Tendances.
  readonly #trendTitles = new Map<number, { at: number; titles: TrendTitle[] }>()

  constructor(options: NewsSearchOptions) {
    this.#options = options
  }

  // The household's sources changed: Tendances are worked out again.
  forgetTrends() {
    this.#trendTitles.delete(currentHouseholdId())
  }

  // The topic that lists a source first: where its articles show in search results and "Le fil".
  topicOf(sourceId: string) {
    return this.#options.catalog().topics.find(topic => topic.sources.some(source => source.id === sourceId)) ?? null
  }

  #sectionOf(sourceId: string) {
    return (
      this.#options.catalog().listen.find(section => section.sources.some(source => source.id === sourceId)) ?? null
    )
  }

  async #listAll(language: Language) {
    return Promise.all(
      this.#options.catalog().topics.map(async topic => {
        const listed = await this.#options.lister.list(topic, MAX_TOPIC_LIMIT, { check: false })
        return {
          ...listed,
          items: listed.items.map(item => ({ ...item, topicId: topic.id, topicLabel: labelIn(topic, language) }))
        }
      })
    )
  }

  // Articles of every topic whose title or summary holds all the words (at a word start), newest first.
  // Matching articles not checked yet are checked now (a few at most): they show up on the next search.
  async search(query: string, language: Language): Promise<SearchResult> {
    const words = query.split(/\s+/).filter(Boolean)

    if (words.length === 0) return { items: [], checking: 0 }

    const matches = matcherOf(query, words)
    const lists = await this.#listAll(language)
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
    const older = this.#olderMatches(words, matches, seen, language)
    const toCheck = [...new Set(lists.flatMap(list => list.unchecked))]
      .filter(item => matches([item.sourceName, item.title, item.summary]))
      .slice(0, MAX_SEARCH_CHECKS)

    toCheck.forEach(item => this.#options.checks.add(item.id))

    return { items: [...items, ...older].sort(byNewest).slice(0, MAX_SEARCH_RESULTS), checking: toCheck.length }
  }

  // Older articles, gone from the topics' window, that the store still knows. Words naming a source ("RFI climat")
  // look for the other words in that source's articles.
  #olderMatches(words: string[], matches: (texts: string[]) => boolean, seen: Set<string>, language: Language) {
    const { store, loader } = this.#options
    const sources = allSources(this.#options.catalog())
    const namesSource = (word: string) => sources.some(source => wordPattern(word).test(foldText(source.name)))
    const named = sources.filter(source => words.some(word => wordPattern(word).test(foldText(source.name))))
    const rest = words.filter(word => !namesSource(word))
    const stored = [
      ...(store?.search(
        words,
        sources.map(source => source.id),
        MAX_STORED_SEARCH_ROWS
      ) ?? []),
      ...(named.length > 0 && rest.length > 0
        ? (store?.search(
            rest,
            named.map(source => source.id),
            MAX_STORED_SEARCH_ROWS
          ) ?? [])
        : [])
    ]
    return stored.flatMap((row): SearchItem[] => {
      const item = loader.adoptStored(row)
      const topic = this.topicOf(item.sourceId)
      const source = topic?.sources.find(candidate => candidate.id === item.sourceId)
      const listedItem = source && loader.listedItem(item, source)
      if (!topic || !listedItem || seen.has(item.id) || !matches([item.sourceName, item.title, item.summary])) return []
      seen.add(item.id)
      return [{ ...listedItem, topicId: topic.id, topicLabel: labelIn(topic, language) }]
    })
  }

  // "Historique": the articles and videos with these ids that the feeds or the store still know, in that order.
  // Read once, they stay listed even when they would be hidden from a topic now.
  history(ids: string[], language: Language): SearchItem[] {
    const { loader } = this.#options
    const items = ids.flatMap(id => {
      const found = loader.findItem(id)
      // A video or an episode has no topic: its Vidéos section stands for one.
      const topic = found && (this.topicOf(found.item.sourceId) ?? this.#sectionOf(found.item.sourceId))
      if (!found || !topic) return []
      const item = loader.listedItem(found.item, found.source) ?? {
        ...found.item,
        access: 'reader' as const,
        related: [],
        readingMinutes: null,
        author: null
      }
      return [{ ...item, topicId: topic.id, topicLabel: labelIn(topic, language) }]
    })
    // Seen videos show their length, as in Vidéos.
    return this.#options.videoLengths?.apply([{ items }])[0]?.items ?? items
  }

  // The phrases most titles of the last 48 hours share, for the search page. Feeds are not fetched for it.
  // The day's most covered subjects, without what the profile turned off.
  async trends(filter: ReaderFilter): Promise<Trend[]> {
    const now = this.#options.now()
    const kept = this.#trendTitles.get(currentHouseholdId())
    if (!kept || now - kept.at >= TRENDS_TTL_MS) {
      this.#trendTitles.set(currentHouseholdId(), { at: now, titles: await this.#recentTitles(now) })
    }
    const hidden = filtered(filter)
    return trendsOf(
      this.#trendTitles
        .get(currentHouseholdId())!
        .titles.filter(entry => !filter.hiddenTopics.includes(entry.topicId) && !hidden(entry))
    )
  }

  async #recentTitles(now: number): Promise<TrendTitle[]> {
    const since = new Date(now - TRENDS_WINDOW_MS).toISOString()
    const lists = await Promise.all(
      this.#options.catalog().topics.map(async topic => ({
        topic,
        listed: await this.#options.lister.list(topic, MAX_TOPIC_LIMIT, { check: false })
      }))
    )
    const seen = new Set<string>()
    return lists.flatMap(({ topic, listed }) =>
      listed.items
        .filter(item => item.publishedAt !== null && item.publishedAt >= since)
        .flatMap(item => [item, ...item.related.map(related => ({ ...related, summary: '' }))])
        .filter(item => !seen.has(item.id) && seen.add(item.id))
        .map(item => ({ title: item.title, topicId: topic.id, sourceId: item.sourceId ?? '', summary: item.summary }))
    )
  }
}
