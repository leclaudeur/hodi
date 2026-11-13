import type { NewsStore } from '../db/news-store.ts'
import type { Source } from './catalog.ts'
import type { FetchText } from './fetch-text.ts'
import { type FeedEntry, type FeedItem, parseFeedEntries } from './feed-parser.ts'
import type { SourceStatus } from './news-types.ts'

// Feeds are cached in memory for a short time, a failed one for less.
export const CACHE_TTL_MS = 15 * 60 * 1000
export const ERROR_TTL_MS = 60 * 1000
// "Tirer pour rafraîchir" fetches the feeds again, at most this often.
const FORCED_REFRESH_MIN_MS = 60 * 1000

export interface SourceEntry {
  startedAt: number
  expiresAt: number
  pending: Promise<void>
  items: FeedItem[]
  // Full article HTML from the feed, by item id, for sites that block article pages.
  contents: Map<string, string>
  fetchedAt: number | null
  error: string | null
}

interface FeedCacheOptions {
  fetchText: FetchText
  // A plugin's feed (plugin:<id>/<key>), read through the plugin instead of fetched.
  readPluginFeed: ((source: Source) => Promise<FeedEntry[]>) | undefined
  store: NewsStore | undefined
  isPaused: (sourceId: string) => boolean
  now: () => number
  log: (message: string) => void
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

// youtube.com or one of its subdomains, never a look-alike such as notyoutube.com.
export const isYouTubeHost = (hostname: string) => hostname === 'youtube.com' || hostname.endsWith('.youtube.com')

// A YouTube feed opens its channel or playlist; other feeds, the home page of their site.
export const siteOf = (source: Source) => {
  const feed = new URL(source.url)
  const channel = feed.searchParams.get('channel_id')
  const playlist = feed.searchParams.get('playlist_id')
  if (isYouTubeHost(feed.hostname) && channel) return `https://www.youtube.com/channel/${channel}`
  if (isYouTubeHost(feed.hostname) && playlist) return `https://www.youtube.com/playlist?list=${playlist}`
  return source.domains[0] ? `https://${source.domains[0]}/` : `${feed.origin}/`
}

// Each source's last fetched items, shared by every household that follows it.
export class FeedCache {
  readonly #options: FeedCacheOptions
  readonly #entries = new Map<string, SourceEntry>()

  constructor(options: FeedCacheOptions) {
    this.#options = options
  }

  get(sourceId: string) {
    return this.#entries.get(sourceId)
  }

  forget(sourceId: string) {
    this.#entries.delete(sourceId)
  }

  // A paused source keeps what it last had; it is fetched again once a profile turns it back on.
  async refreshAll(sources: Source[], fresh = false) {
    const { isPaused } = this.#options
    await Promise.all(sources.filter(source => !isPaused(source.id)).map(source => this.#refresh(source, fresh)))
    return sources.flatMap(source => this.#entries.get(source.id) ?? [])
  }

  statuses(sources: Source[]): SourceStatus[] {
    return sources.map(source => {
      const entry = this.#entries.get(source.id)
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

  #read(source: Source) {
    const { readPluginFeed, fetchText } = this.#options
    if (source.url.startsWith('plugin:')) {
      return readPluginFeed?.(source) ?? Promise.reject(new Error('plugin_unavailable'))
    }
    return fetchText(source.url).then(({ text }) => parseFeedEntries(text, source))
  }

  #refresh(source: Source, fresh = false) {
    const { store, now: clock, log } = this.#options
    const existing = this.#entries.get(source.id)
    const now = clock()
    const recent = existing !== undefined && now - existing.startedAt < FORCED_REFRESH_MIN_MS
    if (existing && existing.expiresAt > now && (!fresh || recent)) return existing.pending

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
    entry.pending = this.#read(source)
      .then(entries => {
        store?.saveFeedEntries(entries, clock())
        entry.items = entries.map(({ item }) => item)
        entry.contents = new Map(
          entries.flatMap(({ item, contentHtml }) => (contentHtml ? [[item.id, contentHtml] as const] : []))
        )
        entry.fetchedAt = clock()
        entry.error = null
      })
      .catch((error: unknown) => {
        entry.error = errorMessage(error)
        entry.expiresAt = clock() + ERROR_TTL_MS
        log(`Feed ${source.id} failed: ${entry.error}`)
      })
    this.#entries.set(source.id, entry)
    return entry.pending
  }
}
