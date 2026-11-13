import type { Catalog, Language, Source, Topic } from './catalog.ts'
import { isSkipped, listenSources } from './catalog.ts'
import type { FeedItem } from './feed-parser.ts'
import { sameStory } from './stories.ts'
import type { NewsStore } from '../db/news-store.ts'
import { type DayRange, dayOf, dayRange } from './days.ts'
import { titleKey } from './text.ts'
import { labelIn } from '../labels.ts'
import type { FeedCache } from './feed-cache.ts'
import type { CheckQueue } from './check-queue.ts'
import type { ArticleLoader } from './article-loader.ts'
import type { DayFeed, ListenFeed, TopicItem } from './news-types.ts'
import type { VideoLengths } from './video-lengths.ts'

// A topic's articles as its page lists them: from the feeds and the store, within the window, grouped by story, and
// only once they are known to open in the reader. "Le fil" lists a day of them.

export const MAX_TOPIC_LIMIT = 300
// "Le fil" skips this many empty days at most in one request.
const MAX_EMPTY_DAYS = 7
export const DAY_MS = 24 * 60 * 60 * 1000

export const byNewest = (a: FeedItem, b: FeedItem) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '')

// The same article twice in a source's feeds. Other sources on the same story are grouped instead.
export const dedupe = (items: FeedItem[]) => {
  const seen = new Set<string>()

  return items.filter(item => {
    const keys = [item.id, `${item.sourceId} ${titleKey(item.title)}`]
    if (keys.some(key => seen.has(key))) return false
    keys.forEach(key => seen.add(key))
    return true
  })
}

// The newest article of a story gets the card; other sources on it are listed with it.
const addToStories = (items: TopicItem[], item: TopicItem) => {
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

const inWindow =
  ({ since, until }: { since: string; until: string | null }) =>
  (item: FeedItem) =>
    item.publishedAt === null
      ? until === null
      : item.publishedAt >= since && (until === null || item.publishedAt < until)

export interface ListOptions {
  check: boolean
  fresh?: boolean
  background?: boolean
  window?: { since: string; until: string | null }
}

interface TopicListerOptions {
  feeds: FeedCache
  store: NewsStore | undefined
  loader: ArticleLoader
  checks: CheckQueue
  videoLengths: VideoLengths | null
  windows: () => { articleDays: number; videoDays: number }
  now: () => number
}

export class TopicLister {
  readonly #options: TopicListerOptions

  constructor(options: TopicListerOptions) {
    this.#options = options
  }

  // Articles the store still knows but the feeds no longer list, with their verdicts.
  storedItems(sources: Source[], since: string, until: string | null = null): FeedItem[] {
    const { store, loader } = this.#options
    if (!store) return []

    return store
      .listItems(
        sources.map(source => source.id),
        since,
        until
      )
      .map(stored => loader.adoptStored(stored))
  }

  // check: queue unknown articles for a readability check, and count them as being checked.
  // Otherwise they are returned as unchecked. fresh: fetch the feeds again (see getTopic).
  // window: the dates listed, the last days of Serveur › Contenu (3 by default). Undated articles count as new, so are listed
  // only when the window reaches now (until null).
  async list(topic: Topic, limit: number, { check, fresh = false, background = false, window }: ListOptions) {
    const { feeds, loader, checks, now } = this.#options
    const { since, until } = window ?? {
      since: new Date(now() - this.#options.windows().articleDays * DAY_MS).toISOString(),
      until: null
    }
    const entries = await feeds.refreshAll(topic.sources, fresh)
    const fromFeeds = entries.flatMap(entry => entry.items)
    const candidates = dedupe([...fromFeeds, ...this.storedItems(topic.sources, since, until)].sort(byNewest)).filter(
      inWindow({ since, until })
    )
    const sources = new Map(topic.sources.map(source => [source.id, source]))
    const items: TopicItem[] = []
    const unchecked: FeedItem[] = []
    const at = now()
    let checking = 0
    let hasMore = false

    // Only articles that open in the reader are listed; unknown ones are checked in the background.
    for (const item of candidates) {
      if (items.length >= limit) {
        hasMore = true
        break
      }

      const source = sources.get(item.sourceId)
      if (source && isSkipped(source, item.link)) continue
      const listed = source && loader.listedItem(item, source)
      if (listed) {
        addToStories(items, listed)
        continue
      }

      if (loader.hasVerdict(item.id) || loader.failedRecently(item.id, at)) continue
      if (!check) {
        unchecked.push(item)
        continue
      }
      checking++
      checks.add(item.id, background)
    }

    return { items, checking, hasMore, unchecked }
  }

  // "Le fil": an empty day is skipped for the next one with articles, unless articles of it are still being checked.
  async day(topics: Topic[], day: string | null, timeZone: string, language: Language): Promise<DayFeed | null> {
    const today = dayOf(this.#options.now(), timeZone)
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
        const listed = await this.list(topic, MAX_TOPIC_LIMIT, {
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
    const latest = this.#latestBefore(
      topics.flatMap(topic => topic.sources),
      range.start
    )

    return {
      day: range.day,
      items,
      checking: lists.reduce((total, list) => total + list.checking, 0),
      previousDay: latest ? dayOf(Date.parse(latest), timeZone) : null
    }
  }

  // The newest article before a day, in the feeds or the store: the day "Le fil" goes back to.
  #latestBefore(sources: Source[], start: string) {
    const inMemory = sources
      .flatMap(source => this.#options.feeds.get(source.id)?.items ?? [])
      .reduce<string | null>(
        (latest, item) =>
          item.publishedAt !== null && item.publishedAt < start && (latest === null || item.publishedAt > latest)
            ? item.publishedAt
            : latest,
        null
      )
    const stored = this.#options.store?.latestBefore([...new Set(sources.map(source => source.id))], start) ?? null
    return [inMemory, stored]
      .filter(date => date !== null)
      .sort()
      .at(-1)
  }

  // "Vidéos": the videos and episodes of the window, newest first, grouped by section.
  async listen(catalog: Catalog, language: Language): Promise<ListenFeed> {
    const { feeds, videoLengths, now } = this.#options
    const sources = listenSources(catalog)

    await feeds.refreshAll(sources)

    const oldest = new Date(now() - this.#options.windows().videoDays * DAY_MS).toISOString()
    const sections = catalog.listen.map(section => ({
      id: section.id,
      label: labelIn(section, language),
      items: dedupe([
        ...section.sources.flatMap(source => feeds.get(source.id)?.items ?? []),
        ...this.storedItems(section.sources, oldest)
      ])
        .filter(item => item.publishedAt === null || item.publishedAt >= oldest)
        .sort(byNewest)
    }))

    return { sections: videoLengths?.apply(sections) ?? sections, sources: feeds.statuses(sources) }
  }
}
