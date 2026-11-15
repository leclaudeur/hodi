import type { Catalog, Source } from '../news/catalog.ts'
import type { FeedEntry } from '../news/feed-parser.ts'
import { canonicalLink, itemId, truncate } from '../news/text.ts'
import type { PluginFeed } from './manifest.ts'
import type { PluginRegistry } from './registry.ts'

// A plugin's feed is a source like any other (one row of sources, followed by households), but its address names the
// plugin and the feed instead of a site: Hodi asks the plugin for its articles in place of fetching a page.
const SCHEME = 'plugin:'
export const MAX_FEED_ITEMS = 100
const MAX_TITLE = 300
// As long as a feed's own summary (feed-parser.ts).
const MAX_SUMMARY = 280

export const isPluginFeed = (source: Pick<Source, 'url'>) => source.url.startsWith(SCHEME)

// plugin:<plugin id>/<feed key>, as stored in sources.url.
export const feedAddress = (url: string) => {
  const match = /^plugin:([a-z][a-z0-9-]{1,31})\/([a-zA-Z][a-zA-Z0-9]{0,31})$/.exec(url)
  return match ? { pluginId: match[1]!, key: match[2]! } : null
}

// The source a feed of a plugin becomes once a household adds it. Its articles never open in the reader: the app
// shows their summary and a link to the plugin's site.
export const feedSource = (pluginId: string, feed: PluginFeed): Source => ({
  id: `plugin-${pluginId}-${feed.key.toLowerCase()}`,
  name: feed.name,
  url: `${SCHEME}${pluginId}/${feed.key}`,
  kind: 'article',
  lang: feed.lang,
  domains: [feed.site],
  reader: false,
  skip: []
})

const plainText = (value: unknown, max: number) =>
  // Plain text only: no tag survives, and control characters go.
  typeof value === 'string'
    ? truncate(
        value
          .replace(/<[^>]*>/g, ' ')
          // eslint-disable-next-line no-control-regex -- matching control characters is the point
          .replace(/[\u0000-\u001f\u007f]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim(),
        max
      )
    : ''

// https on the feed's site or one of its subdomains: a plugin's article never sends anyone elsewhere.
const onSite = (value: unknown, site: string) => {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) return null
    return url.hostname === site || url.hostname.endsWith(`.${site}`) ? url.href : null
  } catch {
    return null
  }
}

const date = (value: unknown) => {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}

// What a plugin's feed handler answered, as Hodi's own feed entries: at most MAX_FEED_ITEMS articles, each with a
// title and a link on its site. An article that does not fit is left out, never the whole feed.
export const feedEntries = (source: Source, answer: unknown): FeedEntry[] => {
  if (!Array.isArray(answer)) throw new Error('a feed answers a list of articles')
  const site = source.domains[0] ?? ''
  const seen = new Set<string>()
  const entries: FeedEntry[] = []
  for (const value of answer.slice(0, MAX_FEED_ITEMS)) {
    if (typeof value !== 'object' || value === null) continue
    const raw = value as Record<string, unknown>
    const title = plainText(raw.title, MAX_TITLE)
    const link = onSite(raw.link, site)
    if (!title || !link) continue
    const canonical = canonicalLink(link)
    const id = itemId(canonical)
    if (seen.has(id)) continue
    seen.add(id)
    entries.push({
      item: {
        id,
        sourceId: source.id,
        sourceName: source.name,
        kind: 'article',
        lang: source.lang,
        title,
        summary: plainText(raw.summary, MAX_SUMMARY),
        link: canonical,
        publishedAt: date(raw.publishedAt),
        image: httpsImage(raw.image),
        media: null
      },
      contentHtml: null
    })
  }
  return entries
}

// A picture may come from another host (a CDN), but only over https: the server fetches it like a feed's own.
const httpsImage = (value: unknown) => {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null
  } catch {
    return null
  }
}

// Hodi's catalogue with the feeds of the active plugins added to the topics they name, for « Sources proposées ». A
// feed naming a topic Hodi does not have is left out.
export const withPluginFeeds = (
  catalog: Catalog,
  plugins: Pick<PluginRegistry, 'list' | 'enabled'> | undefined
): Catalog => {
  const offered = (plugins?.list() ?? []).flatMap(plugin =>
    plugin.manifest && plugin.shape && plugins?.enabled(plugin.id)
      ? plugin.manifest.feeds
          .filter(feed => plugin.shape?.feeds.includes(feed.key))
          .map(feed => ({ topic: feed.topic, source: feedSource(plugin.id, feed) }))
      : []
  )
  if (offered.length === 0) return catalog
  return {
    ...catalog,
    topics: catalog.topics.map(topic => {
      const added = offered.filter(feed => feed.topic === topic.id).map(feed => feed.source)
      return added.length > 0 ? { ...topic, sources: [...topic.sources, ...added] } : topic
    })
  }
}

// Reads a followed feed through its plugin, for NewsService.
export const pluginFeedReader =
  (plugins: () => Pick<PluginRegistry, 'readFeed'> | null) =>
  async (source: Source): Promise<FeedEntry[]> => {
    const address = feedAddress(source.url)
    const registry = plugins()
    if (!address || !registry) throw new Error('plugin_unavailable')
    return feedEntries(source, await registry.readFeed(address.pluginId, address.key))
  }
