import type { Language } from '../../shared/i18n.ts'
import type { ExtractedArticle } from '../news/extract.ts'
import type { FeedEntry, FeedItem } from '../news/feed-parser.ts'
import { foldText, romanNumeral } from '../../shared/word-match.ts'
import { type Database, transaction } from './database.ts'
import {
  type AiCall,
  type AiCallKind,
  type AiCleared,
  type StoredDailySummary,
  aiCalls,
  clearAiCalls,
  latestDailySummaries,
  recordAiCall,
  saveDailySummary
} from './ai-queries.ts'

import { type StoredIcon, getIcon, getVideoDurations, saveIcon, saveVideoDuration } from './media-queries.ts'

// Readability verdict of an article, as NewsService keeps it, with what its card shows once it is read.
export interface StoredVerdict {
  readable: boolean
  image: string | null
  minutes: number | null
  author: string | null
}

export interface StoredItem {
  item: FeedItem
  verdict: StoredVerdict | null
}

// The reader mode text and the feed's full HTML are dropped after this; the article row stays.
export const CONTENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const AI_CALL_RETENTION_MS = 2 * 24 * 60 * 60 * 1000
const VIDEO_DURATION_RETENTION_MS = 90 * 24 * 60 * 60 * 1000
const DAILY_SUMMARY_RETENTION = 30

interface ArticleRow {
  id: string
  source_id: string
  source_name: string
  kind: string
  lang: string
  title: string
  summary: string
  link: string
  published_at: string | null
  image: string | null
  media: string | null
  readable: number | null
  page_image: string | null
  reading_minutes: number | null
  author: string | null
}

const ARTICLE_COLUMNS =
  'id, source_id, source_name, kind, lang, title, summary, link, published_at, image, media, readable, page_image, reading_minutes, author'

const toStoredItem = (row: ArticleRow): StoredItem => ({
  item: {
    id: row.id,
    sourceId: row.source_id,
    sourceName: row.source_name,
    kind: row.kind as FeedItem['kind'],
    lang: row.lang as FeedItem['lang'],
    title: row.title,
    summary: row.summary,
    link: row.link,
    publishedAt: row.published_at,
    image: row.image,
    media: row.media ? (JSON.parse(row.media) as FeedItem['media']) : null
  },
  verdict:
    row.readable === null
      ? null
      : { readable: row.readable === 1, image: row.page_image, minutes: row.reading_minutes, author: row.author }
})

const placeholders = (values: unknown[]) => values.map(() => '?').join(', ')

// One word of a search as an FTS5 prefix term: "élect" finds "élections". Punctuation is left out,
// as the index's tokenizer does; a number stands whole, or as a Roman numeral ("6" finds "VI").
const ftsTerm = (word: string) => {
  const tokens = foldText(word)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
  if (tokens.length === 0) return null

  return tokens
    .map(token => {
      if (!/^\d+$/.test(token)) return `"${token}"*`
      const roman = romanNumeral(Number(token))
      return roman ? `("${token}" OR "${roman}")` : `"${token}"`
    })
    .join(' AND ')
}

// Everything NewsService keeps beyond a restart: articles, verdicts, reader text and paid AI output.
export class NewsStore {
  readonly #db: Database

  // How long a dropped article keeps its text (and its pictures): Serveur › Contenu, 7 days by default.
  readonly #retention: () => number

  constructor(db: Database, retention: () => number = () => CONTENT_RETENTION_MS) {
    this.#db = db
    this.#retention = retention
  }

  // A feed's current items: new ones are added, known ones refreshed (the title or image may change).
  saveFeedEntries(entries: FeedEntry[], now: number) {
    const upsert = this.#db.prepare(`
      INSERT INTO articles (id, source_id, source_name, kind, lang, title, summary, link, published_at, image, media,
        feed_content, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        source_name = excluded.source_name,
        title = excluded.title,
        summary = excluded.summary,
        link = excluded.link,
        published_at = COALESCE(excluded.published_at, published_at),
        image = COALESCE(excluded.image, image),
        media = COALESCE(excluded.media, media),
        -- The feed's HTML only matters until the article is checked.
        feed_content = CASE WHEN readable IS NULL THEN COALESCE(excluded.feed_content, feed_content) END,
        last_seen_at = excluded.last_seen_at`)

    transaction(this.#db, () => {
      for (const { item, contentHtml } of entries) {
        upsert.run(
          item.id,
          item.sourceId,
          item.sourceName,
          item.kind,
          item.lang,
          item.title,
          item.summary,
          item.link,
          item.publishedAt,
          item.image,
          item.media ? JSON.stringify(item.media) : null,
          contentHtml,
          now,
          now
        )
      }
    })
  }

  // The sources' items published since the given date, newest first: before `until` when given, otherwise
  // undated ones too.
  listItems(sourceIds: string[], since: string, until: string | null = null): StoredItem[] {
    if (sourceIds.length === 0) return []

    const rows = this.#db
      .prepare(
        `SELECT ${ARTICLE_COLUMNS} FROM articles
         WHERE source_id IN (${placeholders(sourceIds)})
         AND ${until === null ? '(published_at IS NULL OR published_at >= ?)' : 'published_at >= ? AND published_at < ?'}
         ORDER BY published_at DESC`
      )
      .all(...sourceIds, since, ...(until === null ? [] : [until])) as unknown as ArticleRow[]

    return rows.map(toStoredItem)
  }

  // When the newest of the sources' items published before that date came out, if any.
  latestBefore(sourceIds: string[], before: string): string | null {
    if (sourceIds.length === 0) return null

    const row = this.#db
      .prepare(
        `SELECT MAX(published_at) AS latest FROM articles
         WHERE source_id IN (${placeholders(sourceIds)}) AND published_at < ?`
      )
      .get(...sourceIds, before) as { latest: string | null }
    return row.latest
  }

  // The sources' items whose title or summary has every word (at a word start, accents and case aside),
  // newest first. NewsService still filters them as it does the feeds' items.
  search(words: string[], sourceIds: string[], limit: number): StoredItem[] {
    const terms = words.map(ftsTerm).filter(term => term !== null)
    if (terms.length === 0 || sourceIds.length === 0) return []

    const rows = this.#db
      .prepare(
        `SELECT ${ARTICLE_COLUMNS.split(', ')
          .map(column => `articles.${column}`)
          .join(', ')}
         FROM articles_fts JOIN articles ON articles.rowid = articles_fts.rowid
         WHERE articles_fts MATCH ? AND articles.source_id IN (${placeholders(sourceIds)})
         ORDER BY articles.published_at DESC LIMIT ?`
      )
      .all(terms.join(' AND '), ...sourceIds, limit) as unknown as ArticleRow[]

    return rows.map(toStoredItem)
  }

  findItem(id: string): (StoredItem & { feedContent: string | null }) | null {
    const row = this.#db.prepare(`SELECT ${ARTICLE_COLUMNS}, feed_content FROM articles WHERE id = ?`).get(id) as
      (ArticleRow & { feed_content: string | null }) | undefined

    return row ? { ...toStoredItem(row), feedContent: row.feed_content } : null
  }

  saveVerdict(id: string, verdict: StoredVerdict) {
    this.#db
      // Checked: the feed's HTML is no longer needed (the reader text, if any, is stored on its own).
      .prepare(
        `UPDATE articles SET readable = ?, page_image = ?, reading_minutes = ?, author = ?, feed_content = NULL
         WHERE id = ?`
      )
      .run(verdict.readable ? 1 : 0, verdict.image, verdict.minutes, verdict.author, id)
  }

  getContent(id: string): ExtractedArticle | null {
    const row = this.#db
      .prepare('SELECT title, byline, content_html, text_length, image FROM article_content WHERE article_id = ?')
      .get(id) as
      | { title: string | null; byline: string | null; content_html: string; text_length: number; image: string | null }
      | undefined

    return row
      ? {
          title: row.title,
          byline: row.byline,
          contentHtml: row.content_html,
          textLength: row.text_length,
          image: row.image
        }
      : null
  }

  // The latest stored texts of a source's other articles, to recognise the site's own blocks in one of them.
  getSourceContents(sourceId: string, exceptId: string, limit: number): string[] {
    const rows = this.#db
      .prepare(
        `SELECT c.content_html FROM article_content c JOIN articles a ON a.id = c.article_id
         WHERE a.source_id = ? AND a.id != ? ORDER BY c.extracted_at DESC LIMIT ?`
      )
      .all(sourceId, exceptId, limit) as { content_html: string }[]
    return rows.map(row => row.content_html)
  }

  saveContent(id: string, article: ExtractedArticle, now: number) {
    this.#db
      .prepare(
        `INSERT OR REPLACE INTO article_content (article_id, title, byline, content_html, text_length, image, extracted_at)
         SELECT id, ?, ?, ?, ?, ?, ? FROM articles WHERE id = ?`
      )
      .run(article.title, article.byline, article.contentHtml, article.textLength, article.image, now, id)
  }

  // An article's summary in the given language, if one was written.
  getSummary(id: string, language: Language): string[] | null {
    const row = this.#db
      .prepare('SELECT points FROM ai_summaries WHERE article_id = ? AND language = ?')
      .get(id, language) as { points: string } | undefined

    return row ? (JSON.parse(row.points) as string[]) : null
  }

  saveSummary(id: string, language: Language, points: string[], now: number) {
    this.#db
      .prepare(
        `INSERT OR REPLACE INTO ai_summaries (article_id, language, points, created_at)
         SELECT id, ?, ?, ? FROM articles WHERE id = ?`
      )
      .run(language, JSON.stringify(points), now, id)
  }

  // Each profile's last Résumé du jour.
  latestDailySummaries<Point>() {
    return latestDailySummaries<Point>(this.#db)
  }

  saveDailySummary<Point>(dailySummary: StoredDailySummary<Point>, profileId = 1) {
    saveDailySummary(this.#db, dailySummary, profileId)
  }

  recordAiCall(call: AiCall) {
    recordAiCall(this.#db, call)
  }

  // The calls made since the given time, oldest first.
  aiCalls(since: number) {
    return aiCalls(this.#db, since)
  }

  // "Remettre à 0": the calls since then, of one kind or all, of one profile or all, cleared to that level (never
  // lowered).
  clearAiCalls(since: number, level: AiCleared, kind: AiCallKind | null, profileId: number | null) {
    clearAiCalls(this.#db, since, level, kind, profileId)
  }

  getIcon(sourceId: string) {
    return getIcon(this.#db, sourceId)
  }

  saveIcon(sourceId: string, icon: StoredIcon) {
    saveIcon(this.#db, sourceId, icon)
  }

  // Known lengths, and the videos last asked about since then (not found, or not at all yet: absent).
  getVideoDurations(videoIds: string[], retryAfter: number) {
    return getVideoDurations(this.#db, videoIds, retryAfter)
  }

  saveVideoDuration(videoId: string, seconds: number | null, now: number) {
    saveVideoDuration(this.#db, videoId, seconds, now)
  }

  // How many articles are known, and how many keep their reader text.
  // Articles listed by each source since then, those the reader can't open left out.
  articleCountsBySource(since: string): Map<string, number> {
    const rows = this.#db
      .prepare(
        `SELECT source_id, COUNT(*) AS count FROM articles
         WHERE published_at >= ? AND (readable IS NULL OR readable = 1) GROUP BY source_id`
      )
      .all(since) as { source_id: string; count: number }[]
    return new Map(rows.map(row => [row.source_id, row.count]))
  }

  counts() {
    const count = (sql: string) => (this.#db.prepare(sql).get() as { n: number }).n
    return {
      articles: count('SELECT COUNT(*) AS n FROM articles'),
      texts: count('SELECT COUNT(*) AS n FROM article_content')
    }
  }

  // "Vider" in the settings: every reader text but the saved articles', then the file shrinks.
  // The articles stay; one opened again is read from its site.
  clearTexts() {
    this.#db
      .prepare('DELETE FROM article_content WHERE article_id NOT IN (SELECT article_id FROM saved_articles)')
      .run()
    this.#db.exec('VACUUM')
  }

  // Drops what is no longer worth its space; the article rows themselves stay for search and history,
  // and saved articles keep their text.
  prune(now: number) {
    const contentLimit = now - this.#retention()

    transaction(this.#db, () => {
      this.#db
        .prepare(
          `DELETE FROM article_content WHERE article_id IN (SELECT id FROM articles WHERE last_seen_at < ?)
           AND article_id NOT IN (SELECT article_id FROM saved_articles)`
        )
        .run(contentLimit)
      this.#db
        .prepare('UPDATE articles SET feed_content = NULL WHERE last_seen_at < ? AND feed_content IS NOT NULL')
        .run(contentLimit)
      this.#db.prepare('DELETE FROM ai_calls WHERE at < ?').run(now - AI_CALL_RETENTION_MS)
      // Videos leave "Vidéos" after 60 days.
      this.#db.prepare('DELETE FROM video_durations WHERE fetched_at < ?').run(now - VIDEO_DURATION_RETENTION_MS)
      this.#db
        .prepare(
          `DELETE FROM daily_summaries WHERE id NOT IN (
             SELECT id FROM (
               SELECT id, ROW_NUMBER() OVER (PARTITION BY profile_id ORDER BY created_at DESC) AS n FROM daily_summaries
             ) WHERE n <= ?
           )`
        )
        .run(DAILY_SUMMARY_RETENTION)
    })
  }
}
