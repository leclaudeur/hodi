import path from 'node:path'
import { type Source, allSources, isAllowedHost, loadCatalog } from '../news/catalog.ts'
import { extractArticle, extractFeedContent } from '../news/extract.ts'
import { createFetchText } from '../news/fetch-text.ts'
import { type FeedEntry, parseFeedEntries } from '../news/feed-parser.ts'

// Fetches every feed of sources.yml once and reports what Hodi would get from it:
// item count, newest item date and, for article sources, how many of the latest
// articles open in the reader. Exits with 1 when at least one feed fails.
const fetchText = createFetchText({ timeoutMs: 10_000 })

interface Check {
  source: Source
  ok: boolean
  detail: string
}

// fetch() hides the network cause (DNS, TLS, refused connection) in error.cause.
const errorMessage = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error)

  const cause =
    error.cause instanceof Error ? ` (${(error.cause as NodeJS.ErrnoException).code ?? error.cause.message})` : ''
  return `${error.message}${cause}`
}

const pageCheck = async (source: Source, link: string) => {
  if (!isAllowedHost(source, new URL(link))) return `link outside domains (${new URL(link).hostname})`

  try {
    const page = await fetchText(link)

    if (!isAllowedHost(source, new URL(page.url))) return `redirected to ${new URL(page.url).hostname}`

    return extractArticle(page.text, page.url) ? 'ok' : 'not readable (paywall or too short)'
  } catch (error) {
    return errorMessage(error)
  }
}

const READER_SAMPLE = 3

// Mirrors NewsService: the article page first, then the full text carried by the feed.
const articleCheck = async (source: Source, { item, contentHtml }: FeedEntry) => {
  const page = await pageCheck(source, item.link)

  if (page === 'ok') return { ok: true, note: null }

  const fromFeed = contentHtml && extractFeedContent(contentHtml, item.link)

  return fromFeed ? { ok: true, note: `feed text (page: ${page})` } : { ok: false, note: page }
}

// One article can be a short brief or a live page: sample the latest few instead.
const readerCheck = async (source: Source, entries: FeedEntry[]) => {
  const latest = [...entries]
    .sort((a, b) => (b.item.publishedAt ?? '').localeCompare(a.item.publishedAt ?? ''))
    .slice(0, READER_SAMPLE)
  const results = await Promise.all(latest.map(entry => articleCheck(source, entry)))
  const notes = [...new Set(results.flatMap(result => (result.note ? [result.note] : [])))]
  const readable = results.filter(result => result.ok).length

  return `reader: ${readable}/${results.length} ok${notes.length > 0 ? ` (${notes.join('; ')})` : ''}`
}

const check = async (source: Source): Promise<Check> => {
  try {
    const entries = parseFeedEntries((await fetchText(source.url)).text, source)
    const items = entries.map(({ item }) => item)
    const dates = items.flatMap(item => (item.publishedAt ? [item.publishedAt] : [])).sort()
    const newest = dates.at(-1) ?? 'no date'
    const details = [`${items.length} items`, `newest ${newest.slice(0, 16)}`]

    if (source.kind === 'article' && !source.reader) details.push('link only')
    else if (source.kind === 'article' && entries.length > 0) details.push(await readerCheck(source, entries))

    return { source, ok: items.length > 0, detail: details.join(', ') }
  } catch (error) {
    return { source, ok: false, detail: errorMessage(error) }
  }
}

const catalog = loadCatalog(path.resolve(process.env.SOURCES_FILE ?? 'sources.yml'))
const sources = allSources(catalog)
const checks = await Promise.all(sources.map(check))
const width = Math.max(...sources.map(source => source.id.length))

for (const { source, ok, detail } of checks) {
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${source.id.padEnd(width)}  ${detail}`)
}

const failed = checks.filter(result => !result.ok).length

console.log(`\n${checks.length - failed}/${checks.length} feeds OK`)
process.exitCode = failed > 0 ? 1 : 0
