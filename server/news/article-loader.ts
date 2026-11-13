import type { Catalog, Source } from './catalog.ts'
import { allSources, isAllowedHost, isSkipped } from './catalog.ts'
import { articleAuthor, cleanArticleHtml, extractArticle, extractFeedContent, readingMinutes } from './extract.ts'
import type { ExtractPage } from './extract-pool.ts'
import type { FetchText } from './fetch-text.ts'
import type { FeedItem } from './feed-parser.ts'
import { removeSiteTemplate } from './site-template.ts'
import type { NewsStore, StoredItem, StoredVerdict } from '../db/news-store.ts'
import { CACHE_TTL_MS, ERROR_TTL_MS, type FeedCache } from './feed-cache.ts'
import type { ArticleResult, TopicItem } from './news-types.ts'

// The reader's side of the news: an article's page fetched and its text extracted once, kept for a while, and the
// verdict on whether it opens in the reader.

const MAX_CACHED_ARTICLES = 400
// The source's other articles compared with one, to find the site's own blocks in it.
const TEMPLATE_SAMPLE = 5
const MAX_VERDICTS = 5000

type Verdict = StoredVerdict

interface ArticleEntry {
  expiresAt: number
  result: Promise<ArticleResult>
  // The site did not answer: the article is checked again once the entry expires.
  failed: boolean
}

interface ArticleLoaderOptions {
  catalog: () => Catalog
  fetchText: FetchText
  store: NewsStore | undefined
  feeds: FeedCache
  // How long each extraction took, for the checks' pace.
  recordExtraction: (ms: number) => void
  // Where a page's text is extracted: its own thread when Hodi runs (start/news.ts), here in tests.
  extractPage?: ExtractPage
  now: () => number
  log: (message: string) => void
}

const extractHere: ExtractPage = async (html, url) => extractArticle(html, url)

export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

export class ArticleLoader {
  readonly #options: ArticleLoaderOptions
  readonly #articles = new Map<string, ArticleEntry>()
  // Item id -> whether the article opens in the reader.
  readonly #verdicts = new Map<string, Verdict>()
  #previewOf: (itemId: string) => string | null = () => null
  // Told of each article read from its site for the first time, as the reader got it (plugins listen).
  #onArticle: ((result: ArticleResult) => void) | null = null

  constructor(options: ArticleLoaderOptions) {
    this.#options = options
  }

  setImagePreviews(previewOf: (itemId: string) => string | null) {
    this.#previewOf = previewOf
  }

  setArticleListener(listener: (result: ArticleResult) => void) {
    this.#onArticle = listener
  }

  // An article's page as its site serves it now, for a plugin that keeps a copy: only an item a source listed, and
  // only from that source's domains, as the reader does. null when it cannot be had.
  async fetchArticlePage(itemId: string): Promise<{ url: string; html: string } | null> {
    const found = this.findItem(itemId)
    if (!found || found.item.kind !== 'article' || !isAllowedHost(found.source, new URL(found.item.link))) return null
    try {
      const page = await this.#options.fetchText(found.item.link)
      return isAllowedHost(found.source, new URL(page.url)) ? { url: page.url, html: page.text } : null
    } catch (error) {
      this.#options.log(`Article page ${found.item.link} failed: ${errorMessage(error)}`)
      return null
    }
  }

  adoptStored({ item, verdict }: StoredItem) {
    if (verdict && !this.#verdicts.has(item.id)) this.#rememberVerdict(item.id, verdict)
    return item
  }

  hasVerdict(itemId: string) {
    return this.#verdicts.has(itemId)
  }

  // Its site did not answer a moment ago: it is not checked again before its entry expires.
  failedRecently(itemId: string, now: number) {
    const article = this.#articles.get(itemId)
    return article?.failed === true && article.expiresAt > now
  }

  // The item as its card shows it, or null when it is not to be listed (yet): unreadable, or not checked.
  listedItem(item: FeedItem, source: Source): TopicItem | null {
    if (isSkipped(source, item.link)) return null
    const imagePreview = this.#previewOf(item.id)
    if (source.reader === false)
      return { ...item, access: 'link', related: [], readingMinutes: null, author: null, imagePreview }

    const verdict = this.#verdicts.get(item.id)
    if (!verdict?.readable) return null

    // RTL info only pastes page chrome in its feed: the article page has the real image.
    return {
      ...item,
      image: item.image ?? verdict.image,
      access: 'reader',
      related: [],
      readingMinutes: verdict.minutes,
      author: verdict.author,
      imagePreview
    }
  }

  async getArticle(itemId: string): Promise<ArticleResult> {
    const now = this.#options.now()

    for (const [id, entry] of this.#articles) {
      if (entry.expiresAt <= now) this.#articles.delete(id)
    }

    const cached = this.#articles.get(itemId)
    if (cached) return cached.result

    // Only items already listed by a configured feed can be fetched: no arbitrary URLs.
    const found = this.findItem(itemId)
    if (!found) return { status: 'unknown' }

    // Extracted before: no need to fetch the page again.
    const stored = found.source.reader ? this.#options.store?.getContent(itemId) : null
    const loaded: Promise<ArticleResult> = stored
      ? // Cleaned again: the cleanup learns new site furniture after the text was stored.
        Promise.resolve({
          status: 'ok',
          item: found.item,
          article: { ...stored, contentHtml: cleanArticleHtml(stored.contentHtml) }
        })
      : this.#loadArticle(found.item, found.source, found.feedContent)
    // The text is stored as extracted; the site's repeated blocks are taken out each time it is served, so an
    // article read before its source had others to compare with is cleaned later too.
    const result = loaded.then(settled => this.#withoutSiteTemplate(settled, found.source.id, itemId))

    if (this.#articles.size >= MAX_CACHED_ARTICLES) {
      const oldest = this.#articles.keys().next().value
      if (oldest !== undefined) this.#articles.delete(oldest)
    }

    const entry: ArticleEntry = { expiresAt: now + CACHE_TTL_MS, result, failed: false }
    this.#articles.set(itemId, entry)

    const settled = await result
    if (!stored) this.#tell(settled)
    await this.#settle(itemId, entry, settled, stored ? null : loaded)
    return settled
  }

  // A network error is retried after a minute; the verdict waits for a real answer. fetched: the page's own
  // extraction, null for a text read from the store.
  async #settle(itemId: string, entry: ArticleEntry, settled: ArticleResult, fetched: Promise<ArticleResult> | null) {
    if (settled.status === 'failed') {
      entry.expiresAt = this.#options.now() + ERROR_TTL_MS
      entry.failed = true
      return
    }
    if (!fetched) return
    const article = settled.status === 'ok' ? settled.article : null
    this.#recordVerdict(itemId, {
      readable: article !== null,
      image: article?.image ?? null,
      minutes: article ? readingMinutes(article) : null,
      author: article ? articleAuthor(article) : null
    })
    const extracted = await fetched
    if (extracted.status === 'ok') this.#options.store?.saveContent(itemId, extracted.article, this.#options.now())
  }

  #tell(result: ArticleResult) {
    try {
      this.#onArticle?.(result)
    } catch (error) {
      this.#options.log(`Article listener failed: ${errorMessage(error)}`)
    }
  }

  #withoutSiteTemplate(settled: ArticleResult, sourceId: string, itemId: string): ArticleResult {
    const { store } = this.#options
    if (settled.status !== 'ok' || !store) return settled
    const others = store.getSourceContents(sourceId, itemId, TEMPLATE_SAMPLE)
    const contentHtml = removeSiteTemplate(settled.article.contentHtml, others)
    return contentHtml === settled.article.contentHtml
      ? settled
      : { ...settled, article: { ...settled.article, contentHtml } }
  }

  #recordVerdict(itemId: string, verdict: Verdict) {
    this.#rememberVerdict(itemId, verdict)
    this.#options.store?.saveVerdict(itemId, verdict)
  }

  #rememberVerdict(itemId: string, verdict: Verdict) {
    this.#verdicts.delete(itemId)
    this.#verdicts.set(itemId, verdict)

    if (this.#verdicts.size > MAX_VERDICTS) {
      const oldest = this.#verdicts.keys().next().value
      if (oldest !== undefined) this.#verdicts.delete(oldest)
    }
  }

  async #loadArticle(item: FeedItem, source: Source, storedFeedContent: string | null): Promise<ArticleResult> {
    if (item.kind !== 'article' || !source.reader) return { status: 'unreadable', item }

    const fromPage = await this.#loadArticlePage(item, source)
    if (fromPage.status === 'ok') return fromPage

    // Some sites block article pages but publish the full text in their feed.
    const feedContent = this.#options.feeds.get(source.id)?.contents.get(item.id) ?? storedFeedContent
    const article = feedContent ? extractFeedContent(feedContent, item.link) : null

    return article ? { status: 'ok', item, article } : fromPage
  }

  async #loadArticlePage(item: FeedItem, source: Source): Promise<ArticleResult> {
    if (!isAllowedHost(source, new URL(item.link))) {
      return { status: 'unreadable', item }
    }

    try {
      const page = await this.#options.fetchText(item.link)

      // Redirects must not lead outside the source's domains.
      if (!isAllowedHost(source, new URL(page.url))) {
        return { status: 'unreadable', item }
      }

      const started = performance.now()
      const article = await (this.#options.extractPage ?? extractHere)(page.text, page.url)
      const elapsed = performance.now() - started
      this.#options.recordExtraction(elapsed)
      return article ? { status: 'ok', item, article } : { status: 'unreadable', item }
    } catch (error) {
      this.#options.log(`Article ${item.link} failed: ${errorMessage(error)}`)
      return { status: 'failed', item }
    }
  }

  findItem(itemId: string): { item: FeedItem; source: Source; feedContent: string | null } | null {
    const sources = allSources(this.#options.catalog())

    for (const source of sources) {
      const item = this.#options.feeds.get(source.id)?.items.find(candidate => candidate.id === itemId)
      if (item) return { item, source, feedContent: null }
    }

    // Gone from the feeds but stored: still one of a configured source's items, never an arbitrary URL.
    const stored = this.#options.store?.findItem(itemId)
    const source = stored && sources.find(candidate => candidate.id === stored.item.sourceId)
    return stored && source ? { item: stored.item, source, feedContent: stored.feedContent } : null
  }
}
