import { XMLParser } from 'fast-xml-parser'
import type { Language, Source, SourceKind } from './catalog.ts'
import { guessLanguage } from './language.ts'
import { canonicalLink, decodeEntities, firstImageInHtml, htmlToText, itemId, summaryText, truncate } from './text.ts'

// channelId: the channel's page opens from the player. Missing on videos fetched before it was read.
// durationSeconds: a video's is added from its page once known (see video-durations.ts).
export type ItemMedia =
  | { type: 'youtube'; videoId: string; channelId?: string; durationSeconds?: number }
  | { type: 'audio'; url: string; durationSeconds?: number }

export interface FeedItem {
  id: string
  sourceId: string
  sourceName: string
  kind: SourceKind
  lang: Language
  title: string
  summary: string
  link: string
  publishedAt: string | null
  image: string | null
  media: ItemMedia | null
}

// Full article HTML, when the feed carries it (content:encoded or Atom content).
// Kept out of FeedItem so topic lists stay small.
export interface FeedEntry {
  item: FeedItem
  contentHtml: string | null
}

type Node = Record<string, unknown>

const SUMMARY_LENGTH = 280

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Keep text as strings: a numeric-looking title must not become a number.
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: true,
  isArray: name => ['item', 'entry', 'link', 'enclosure', 'media:content', 'media:thumbnail', 'category'].includes(name)
})

const asNode = (value: unknown): Node | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Node) : undefined

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : value === undefined ? [] : [value])

const text = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return text(value[0])

  const node = asNode(value)
  return node ? text(node['#text']) : ''
}

const attribute = (value: unknown, name: string) => text(asNode(value)?.[`@_${name}`])

// Some feeds (RTL info) still publish http:// links to sites served over https.
const upgradedLink = (value: string, base: string) => {
  try {
    const url = new URL(value, base)
    if (url.protocol === 'http:') url.protocol = 'https:'
    return httpsUrl(url.toString())
  } catch {
    return null
  }
}

const httpsUrl = (value: string, base?: string) => {
  try {
    const url = new URL(value, base)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

const date = (...candidates: unknown[]) => {
  for (const candidate of candidates) {
    const time = Date.parse(text(candidate))
    if (Number.isFinite(time)) return new Date(time).toISOString()
  }

  return null
}

const duration = (value: string) => {
  if (!value) return undefined

  const seconds = value
    .split(':')
    .map(Number)
    .reduce((total, part) => total * 60 + part, 0)

  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined
}

const atomLink = (entry: Node) => {
  const links = asArray(entry.link)
  const alternate = links.find(link => ['', 'alternate'].includes(attribute(link, 'rel'))) ?? links[0]

  return attribute(alternate, 'href') || text(alternate)
}

const firstImage = (node: Node, mediaGroup: Node | undefined) => {
  const enclosure = asArray(node.enclosure).find(entry => attribute(entry, 'type').startsWith('image/'))
  const mediaContent = [...asArray(node['media:content']), ...asArray(mediaGroup?.['media:content'])].find(
    entry => attribute(entry, 'medium') === 'image' || attribute(entry, 'type').startsWith('image/')
  )
  const thumbnail = [...asArray(node['media:thumbnail']), ...asArray(mediaGroup?.['media:thumbnail'])][0]

  for (const candidate of [enclosure, mediaContent, thumbnail]) {
    const url = httpsUrl(attribute(candidate, 'url'))
    if (url) return url
  }

  return httpsUrl(attribute(node['itunes:image'], 'href'))
}

// A channel's feed: https://www.youtube.com/feeds/videos.xml?channel_id=UC…
const channelIdOf = (feedUrl: string) => {
  try {
    return new URL(feedUrl).searchParams.get('channel_id') ?? ''
  } catch {
    return ''
  }
}

const toEntry = (node: Node, source: Source): FeedEntry | null => {
  const mediaGroup = asNode(node['media:group'])
  const rawLink = text(node.link) && !asNode(asArray(node.link)[0]) ? text(node.link) : atomLink(node)
  const permalinkGuid = attribute(node.guid, 'isPermaLink') !== 'false' ? text(node.guid) : ''
  const link = upgradedLink(rawLink.trim() || permalinkGuid, source.url)
  const title = htmlToText(decodeEntities(text(node.title)))

  if (!link || !title) return null

  // Some publishers (La Libre, Moustique) flag subscriber-only items: skip them.
  const accessRights = text(node['dcterms:accessRights']).trim().toLowerCase()
  if (accessRights && accessRights !== 'free') return null

  const canonical = canonicalLink(link)
  const videoId = text(node['yt:videoId'])
  const audio = asArray(node.enclosure).find(entry => attribute(entry, 'type').startsWith('audio/'))
  const audioUrl = httpsUrl(attribute(audio, 'url'))

  let media: ItemMedia | null = null

  if (source.kind === 'video' && /^[\w-]{11}$/.test(videoId)) {
    const channelId = [text(node['yt:channelId']), channelIdOf(source.url)].find(id => /^UC[\w-]{22}$/.test(id))
    media = channelId ? { type: 'youtube', videoId, channelId } : { type: 'youtube', videoId }
  } else if (source.kind === 'podcast' && audioUrl) {
    media = { type: 'audio', url: audioUrl, durationSeconds: duration(text(node['itunes:duration'])) }
  }

  if (source.kind !== 'article' && !media) return null

  // YouTube Shorts: the feed links them to /shorts/ instead of /watch.
  if (media?.type === 'youtube' && new URL(link).pathname.startsWith('/shorts/')) return null

  const summarySource =
    text(node.description) ||
    text(node.summary) ||
    text(mediaGroup?.['media:description']) ||
    text(node['content:encoded']) ||
    text(node.content)

  const contentHtml = text(node['content:encoded']) || text(node.content) || null
  // Descriptions can hold a whole page (RTL info), with logos first: only trust article HTML.
  const htmlImage = contentHtml ? firstImageInHtml(contentHtml) : null

  const summary = truncate(summaryText(summarySource), SUMMARY_LENGTH)

  const item: FeedItem = {
    id: itemId(canonical),
    sourceId: source.id,
    sourceName: source.name,
    kind: source.kind,
    lang: source.lang,
    title,
    summary,
    link: canonical,
    publishedAt: date(node.pubDate, node['dc:date'], node.published, node.updated),
    image: firstImage(node, mediaGroup) ?? (htmlImage ? httpsUrl(decodeEntities(htmlImage), link) : null),
    media
  }

  return { item, contentHtml }
}

// Supports RSS 2.0, RSS 1.0 (RDF) and Atom, including YouTube and podcast extensions.
export const parseFeedEntries = (xml: string, source: Source): FeedEntry[] => {
  const document = asNode(parser.parse(xml)) ?? {}
  const rss = asNode(document.rss)
  const rdf = asNode(document['rdf:RDF'])
  const atom = asNode(document.feed)

  const nodes = rss ? asArray(asNode(rss.channel)?.item) : rdf ? asArray(rdf.item) : atom ? asArray(atom.entry) : null

  if (nodes === null) {
    throw new Error('Not an RSS or Atom feed')
  }

  const entries = nodes.flatMap(node => {
    const record = asNode(node)
    const entry = record ? toEntry(record, source) : null
    return entry ? [entry] : []
  })
  return source.kind === 'article' ? inSourceLanguage(entries, source) : entries
}

// Sites that publish each article twice, in French and in English (Planète Déco): only the source's language is
// kept. Only when the feed holds some of it: a source added without its language said is taken as French, and
// an English one must not lose everything.
const inSourceLanguage = (entries: FeedEntry[], source: Source) => {
  const guessed = entries.map(({ item }) => guessLanguage(`${item.title} ${item.summary}`))
  if (!guessed.includes(source.lang)) return entries
  return entries.filter((_, index) => guessed[index] === null || guessed[index] === source.lang)
}

export const parseFeed = (xml: string, source: Source): FeedItem[] =>
  parseFeedEntries(xml, source).map(entry => entry.item)
