import { isPublicAddressUrl } from './address-guard.ts'
import type { Source, SourceKind } from './catalog.ts'
import { extractArticle, extractFeedContent } from './extract.ts'
import { type FetchText, YOUTUBE_PAGE, YOUTUBE_PAGE_BYTES, createFetchText } from './fetch-text.ts'
import { type FeedEntry, parseFeedEntries } from './feed-parser.ts'
import { siteNameOf, tidySourceName } from './source-name.ts'
import { decodeEntities } from './text.ts'

// "Ajouter une source": from a link a profile pastes (a site, a feed or a YouTube channel),
// the feed to follow, what it lists, and whether its articles open in the reader.

export interface FoundSource {
  name: string
  url: string
  kind: SourceKind
  lang: Source['lang']
  // Empty for a source whose articles open on the site.
  domains: string[]
  reader: boolean
  origin: 'feed' | 'youtube'
  // Of the latest articles tried, how many open in the reader.
  readable: { tried: number; ok: number }
  // The latest titles, to recognise the source.
  samples: string[]
}

export type FindResult =
  | { status: 'ok'; source: FoundSource }
  // invalid: not a link; blocked: a private or local address; none: no feed found; empty: a feed without items;
  // reddit: Reddit closed its feeds (November 2026), its communities cannot be followed.
  | { status: 'invalid' | 'blocked' | 'none' | 'empty' | 'failed' | 'reddit' }

const READER_SAMPLE = 3
const YOUTUBE_FEED = 'https://www.youtube.com/feeds/videos.xml?channel_id='
const CHANNEL_ID = /^UC[\w-]{22}$/
const FEED_TYPES = /application\/(rss|atom)\+xml|application\/xml|text\/xml/i
// Tried on a site whose page names no feed.
const COMMON_FEEDS = ['/feed', '/rss', '/rss.xml', '/feed.xml', '/atom.xml', '/index.xml', '/feed/']

export type IsPublicUrl = (url: URL) => Promise<boolean>

export const isPublicUrl: IsPublicUrl = async url => {
  // A pasted link: https on its usual port only, then the address check every request goes through.
  if (url.protocol !== 'https:' || (url.port && url.port !== '443')) return false
  return isPublicAddressUrl(url)
}

const parseUrl = (text: string) => {
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(text.trim()) ? text.trim() : `https://${text.trim()}`)
    if (url.protocol === 'http:') url.protocol = 'https:'
    return url
  } catch {
    return null
  }
}

const decode = (text: string) => decodeEntities(text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).trim()

// The feed's own title (the first one, the channel's).
const feedTitle = (xml: string) => {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(xml)
  return match ? decode(match[1] ?? '') : ''
}

const attribute = (tag: string, name: string) =>
  new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag)?.slice(1).find(Boolean) ?? null

// <link rel="alternate" type="application/rss+xml" href="…"> in a page's head.
export const feedLinks = (html: string, base: string) =>
  [...html.matchAll(/<link\b[^>]*>/gi)].flatMap(([tag]) => {
    const rel = attribute(tag, 'rel') ?? ''
    const type = attribute(tag, 'type') ?? ''
    const href = attribute(tag, 'href')
    if (!/\balternate\b/i.test(rel) || !FEED_TYPES.test(type) || !href) return []
    try {
      return [new URL(decode(href), base).toString()]
    } catch {
      return []
    }
  })

// A channel page names its id in its canonical link and its data.
export const channelIdOf = (html: string) =>
  /<link[^>]+rel="canonical"[^>]+href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/.exec(html)?.[1] ??
  /"(?:channelId|externalId)":"(UC[\w-]{22})"/.exec(html)?.[1] ??
  null

const isReddit = (url: URL) => /(^|\.)(reddit\.com|redd\.it)$/i.test(url.hostname)

const isYouTube = (url: URL) => /(^|\.)youtube\.com$/i.test(url.hostname)

const languageOf = (xml: string): Source['lang'] => {
  const declared = /<language>\s*([a-z]{2})/i.exec(xml)?.[1] ?? /xml:lang="([a-z]{2})/i.exec(xml)?.[1]
  return declared?.toLowerCase() === 'en' ? 'en' : 'fr'
}

const hostOf = (link: string) => new URL(link).hostname.toLowerCase().replace(/^www\./, '')

// A channel page, past the cookie wall YouTube shows in Europe (as for the videos' lengths), through the same address
// guard, size cap and timeout as every other request.
const fetchYouTubeText = createFetchText({ timeoutMs: 8000, maxBytes: YOUTUBE_PAGE_BYTES })
const fetchYouTubePage = async (url: string) =>
  (await fetchYouTubeText(url, YOUTUBE_PAGE)).text.slice(0, 4 * 1024 * 1024)

// What the finder may reach: only public addresses, the page's and the one it was redirected to.
const pageFetchers = (fetchText: FetchText, isPublic: IsPublicUrl) => {
  const fetchPublic = async (url: string) => {
    if (!(await isPublic(new URL(url)))) throw new BlockedError()
    const page = await fetchText(url)
    if (!(await isPublic(new URL(page.url)))) throw new BlockedError()
    return page
  }

  // Articles open in the reader when most of the latest do, on their site's domain.
  const readerTest = async (entries: FeedEntry[]) => {
    const latest = [...entries]
      .sort((a, b) => (b.item.publishedAt ?? '').localeCompare(a.item.publishedAt ?? ''))
      .slice(0, READER_SAMPLE)
    const results = await Promise.all(
      latest.map(async ({ item, contentHtml }) => {
        try {
          const page = await fetchPublic(item.link)
          if (extractArticle(page.text, page.url)) return true
        } catch {
          // The page is not readable: the feed's own text may be.
        }
        return contentHtml !== null && extractFeedContent(contentHtml, item.link) !== null
      })
    )
    return { tried: results.length, ok: results.filter(Boolean).length }
  }

  // The usual feed addresses of a site, asked together: the first one that is a feed.
  const guessFeed = async (base: string) => {
    const guesses = await Promise.all(
      COMMON_FEEDS.map(path => fetchPublic(new URL(path, base).toString()).catch(() => null))
    )
    return guesses.find(feed => feed && entriesOf(feed.text, feed.url, 'article')) ?? null
  }

  // A site whose page turns Hodi away (a bot wall) often still serves its feed at a usual address.
  const pageOrGuess = (url: URL) =>
    fetchPublic(url.toString()).catch(async (error: unknown) => {
      if (error instanceof BlockedError) throw error
      const guessed = await guessFeed(url.toString())
      if (guessed) return guessed
      throw error
    })

  // The feeds the page names, in its order; else the usual addresses, asked together.
  const namedOrGuessedFeed = async (page: { text: string; url: string }) => {
    const named = [...new Set(feedLinks(page.text, page.url))]
    for (const candidate of named.slice(0, 4)) {
      const feed = await fetchPublic(candidate).catch(() => null)
      if (feed && entriesOf(feed.text, feed.url, 'article')) return feed
    }
    return guessFeed(page.url)
  }

  return { fetchPublic, readerTest, pageOrGuess, namedOrGuessedFeed }
}

const entriesOf = (xml: string, url: string, kind: SourceKind) => {
  try {
    return parseFeedEntries(xml, draft(url, kind))
  } catch {
    return null
  }
}

// siteName: what the site's page calls itself, when the feed was found from it.
const feedSource = async (
  readerTest: ReturnType<typeof pageFetchers>['readerTest'],
  url: string,
  xml: string,
  origin: FoundSource['origin'],
  siteName: string | null
): Promise<FindResult> => {
  const kind: SourceKind = origin === 'youtube' ? 'video' : 'article'
  const entries = entriesOf(xml, url, kind)
  if (!entries) return { status: 'none' }
  if (entries.length === 0) return { status: 'empty' }

  const links = entries.map(entry => entry.item.link)
  const hosts = [...new Set(links.flatMap(link => (URL.canParse(link) ? [hostOf(link)] : [])))]
  const readable = kind === 'article' && origin === 'feed' ? await readerTest(entries) : { tried: 0, ok: 0 }
  const reader = readable.tried > 0 && readable.ok * 2 > readable.tried
  return {
    status: 'ok',
    source: {
      // A channel's title is its name; an article feed's is tidied ("https://www.voici.fr : flux d'articles").
      name:
        origin === 'youtube'
          ? feedTitle(xml).slice(0, 60) || new URL(url).hostname
          : tidySourceName(feedTitle(xml), hosts[0] ? `https://${hosts[0]}` : url, siteName),
      url,
      kind,
      lang: languageOf(xml),
      domains: reader ? hosts.slice(0, 3) : [],
      reader,
      origin,
      readable,
      samples: entries.slice(0, 3).map(entry => entry.item.title)
    }
  }
}

// A channel's id: in its address, or else in its page.
const youTubeChannelOf = async (url: URL, fetchYouTube: (url: string) => Promise<string>) => {
  const id = url.searchParams.get('channel_id') ?? /\/channel\/(UC[\w-]{22})/.exec(url.pathname)?.[1]
  return id && CHANNEL_ID.test(id)
    ? id
    : channelIdOf(
        await fetchYouTube(
          `https://www.youtube.com${url.pathname.replace(/\/(videos|featured|shorts|streams)\/?$/, '')}`
        )
      )
}

export const createSourceFinder = ({
  fetchText,
  fetchYouTube = fetchYouTubePage,
  isPublic = isPublicUrl
}: {
  fetchText: FetchText
  fetchYouTube?: (url: string) => Promise<string>
  isPublic?: IsPublicUrl
}) => {
  const { fetchPublic, readerTest, pageOrGuess, namedOrGuessedFeed } = pageFetchers(fetchText, isPublic)
  const fromFeed = (url: string, xml: string, origin: FoundSource['origin'], siteName: string | null = null) =>
    feedSource(readerTest, url, xml, origin, siteName)

  const find = async (pasted: string): Promise<FindResult> => {
    const url = parseUrl(pasted)
    if (!url) return { status: 'invalid' }
    try {
      if (isReddit(url)) return { status: 'reddit' }

      if (isYouTube(url)) {
        const channel = await youTubeChannelOf(url, fetchYouTube)
        if (!channel) return { status: 'none' }
        const feed = `${YOUTUBE_FEED}${channel}`
        return fromFeed(feed, (await fetchPublic(feed)).text, 'youtube')
      }

      const page = await pageOrGuess(url)
      const direct = entriesOf(page.text, page.url, 'article')
      if (direct) return fromFeed(page.url, page.text, 'feed')

      const siteName = siteNameOf(page.text)
      const feed = await namedOrGuessedFeed(page)
      return feed ? fromFeed(feed.url, feed.text, 'feed', siteName) : { status: 'none' }
    } catch (error) {
      if (error instanceof BlockedError) return { status: 'blocked' }
      // In the server's log, to tell a site that is down from one that refuses Hodi.
      console.warn(`Source lookup failed for ${url.hostname}: ${error instanceof Error ? error.message : error}`)
      return { status: 'failed' }
    }
  }

  return find
}

class BlockedError extends Error {}

// The source as the feed parser needs it while looking: every link kept.
const draft = (url: string, kind: SourceKind): Source => ({
  id: 'draft',
  name: '',
  url,
  kind,
  lang: 'fr',
  domains: [],
  reader: false,
  skip: []
})
