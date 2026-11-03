import { isPublicAddressUrl } from './address-guard.ts'
import type { Source, SourceKind } from './catalog.ts'
import { extractArticle, extractFeedContent } from './extract.ts'
import { type FetchText, YOUTUBE_PAGE, YOUTUBE_PAGE_BYTES, createFetchText } from './fetch-text.ts'
import { type FeedEntry, parseFeedEntries } from './feed-parser.ts'
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

// The feed's own title, else its site's name.
const feedTitle = (xml: string) => {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(xml)
  return match ? decode(match[1] ?? '').slice(0, 60) : ''
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

export const createSourceFinder = ({
  fetchText,
  fetchYouTube = fetchYouTubePage,
  isPublic = isPublicUrl
}: {
  fetchText: FetchText
  fetchYouTube?: (url: string) => Promise<string>
  isPublic?: IsPublicUrl
}) => {
  const fetchPublic = async (url: string) => {
    if (!(await isPublic(new URL(url)))) throw new BlockedError()
    const page = await fetchText(url)
    if (!(await isPublic(new URL(page.url)))) throw new BlockedError()
    return page
  }

  const entriesOf = (xml: string, url: string, kind: SourceKind) => {
    try {
      return parseFeedEntries(xml, draft(url, kind))
    } catch {
      return null
    }
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

  const fromFeed = async (url: string, xml: string, origin: FoundSource['origin']): Promise<FindResult> => {
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
        name: feedTitle(xml) || hosts[0] || new URL(url).hostname,
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

  // The usual feed addresses of a site, asked together: the first one that is a feed.
  const guessFeed = async (base: string) => {
    const guesses = await Promise.all(
      COMMON_FEEDS.map(path => fetchPublic(new URL(path, base).toString()).catch(() => null))
    )
    return guesses.find(feed => feed && entriesOf(feed.text, feed.url, 'article')) ?? null
  }

  const find = async (pasted: string): Promise<FindResult> => {
    const url = parseUrl(pasted)
    if (!url) return { status: 'invalid' }
    try {
      if (isReddit(url)) return { status: 'reddit' }

      if (isYouTube(url)) {
        const id = url.searchParams.get('channel_id') ?? /\/channel\/(UC[\w-]{22})/.exec(url.pathname)?.[1]
        const channel =
          id && CHANNEL_ID.test(id)
            ? id
            : channelIdOf(
                await fetchYouTube(
                  `https://www.youtube.com${url.pathname.replace(/\/(videos|featured|shorts|streams)\/?$/, '')}`
                )
              )
        if (!channel) return { status: 'none' }
        const feed = `${YOUTUBE_FEED}${channel}`
        return fromFeed(feed, (await fetchPublic(feed)).text, 'youtube')
      }

      // A site whose page turns Hodi away (a bot wall) often still serves its feed at a usual address.
      const page = await fetchPublic(url.toString()).catch(async (error: unknown) => {
        if (error instanceof BlockedError) throw error
        const guessed = await guessFeed(url.toString())
        if (guessed) return guessed
        throw error
      })
      const direct = entriesOf(page.text, page.url, 'article')
      if (direct) return fromFeed(page.url, page.text, 'feed')

      // The feeds the page names, in its order; else the usual addresses, asked together.
      const named = [...new Set(feedLinks(page.text, page.url))]
      for (const candidate of named.slice(0, 4)) {
        const feed = await fetchPublic(candidate).catch(() => null)
        if (feed && entriesOf(feed.text, feed.url, 'article')) return fromFeed(feed.url, feed.text, 'feed')
      }
      const guessed = await guessFeed(page.url)
      return guessed ? fromFeed(guessed.url, guessed.text, 'feed') : { status: 'none' }
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
