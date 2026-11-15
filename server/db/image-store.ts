import { type Database, transaction } from './database.ts'
import { CONTENT_RETENTION_MS } from './news-store.ts'
import { inlineImageSources } from '../news/inline-images.ts'

export interface StoredImage {
  // A data: URL of a 16-pixel WebP, or null when the picture failed.
  preview: string | null
  failed: boolean
  createdAt: number
}

// The article pictures the server made smaller: their previews, and which ones could not be made.
export class ImageStore {
  readonly #db: Database

  // How long a dropped article keeps its text (and its pictures): Serveur › Contenu, 7 days by default.
  readonly #retention: () => number

  constructor(db: Database, retention: () => number = () => CONTENT_RETENTION_MS) {
    this.#db = db
    this.#retention = retention
  }

  // The picture an article's card shows: the feed's, else its page's (as NewsService lists it).
  sourceOf(articleId: string): string | null {
    const row = this.#db
      .prepare('SELECT COALESCE(image, page_image) AS image FROM articles WHERE id = ?')
      .get(articleId) as { image: string | null } | undefined
    return row?.image ?? null
  }

  // The address of picture n inside an article's kept text.
  inlineSourceOf(articleId: string, index: number): string | null {
    const row = this.#db.prepare('SELECT content_html FROM article_content WHERE article_id = ?').get(articleId) as
      { content_html: string } | undefined
    return row ? (inlineImageSources(row.content_html)[index] ?? null) : null
  }

  get(articleId: string): StoredImage | null {
    const row = this.#db
      .prepare('SELECT preview, failed, created_at FROM article_images WHERE article_id = ?')
      .get(articleId) as { preview: string | null; failed: number; created_at: number } | undefined
    return row ? { preview: row.preview, failed: row.failed === 1, createdAt: row.created_at } : null
  }

  // Every preview, to fill the cache when the server starts.
  previews(): Map<string, string> {
    const rows = this.#db.prepare('SELECT article_id, preview FROM article_images WHERE preview IS NOT NULL').all() as {
      article_id: string
      preview: string
    }[]
    return new Map(rows.map(row => [row.article_id, row.preview]))
  }

  save(articleId: string, image: StoredImage) {
    this.#db
      .prepare('INSERT OR REPLACE INTO article_images (article_id, preview, failed, created_at) VALUES (?, ?, ?, ?)')
      .run(articleId, image.preview, image.failed ? 1 : 0, image.createdAt)
  }

  // Recent articles whose picture was never made, newest first.
  missing(since: number, limit: number): string[] {
    const rows = this.#db
      .prepare(
        `SELECT id FROM articles
         WHERE COALESCE(image, page_image) IS NOT NULL AND last_seen_at >= ?
         AND id NOT IN (SELECT article_id FROM article_images)
         ORDER BY first_seen_at DESC LIMIT ?`
      )
      .all(since, limit) as { id: string }[]
    return rows.map(row => row.id)
  }

  // Pictures of articles the feeds dropped a while ago go, like their texts; saved articles keep theirs. A failed
  // picture is tried again after the same delay. Returns the articles whose files can go.
  prune(now: number): string[] {
    const limit = now - this.#retention()
    return transaction(this.#db, () => {
      const rows = this.#db
        .prepare(
          `SELECT article_id FROM article_images
           WHERE (failed = 1 AND created_at < ?)
           OR (article_id IN (SELECT id FROM articles WHERE last_seen_at < ?)
             AND article_id NOT IN (SELECT article_id FROM saved_articles))`
        )
        .all(limit, limit) as { article_id: string }[]
      const ids = rows.map(row => row.article_id)
      const remove = this.#db.prepare('DELETE FROM article_images WHERE article_id = ?')
      ids.forEach(id => remove.run(id))
      return ids
    })
  }

  // Every article whose text is still kept, or saved: the pictures inside it stay.
  withText(): Set<string> {
    const rows = this.#db
      .prepare('SELECT article_id FROM article_content UNION SELECT article_id FROM saved_articles')
      .all() as { article_id: string }[]
    return new Set(rows.map(row => row.article_id))
  }

  // Every article that still has a picture, to find files left behind.
  kept(): Set<string> {
    const rows = this.#db.prepare('SELECT article_id FROM article_images WHERE failed = 0').all() as {
      article_id: string
    }[]
    return new Set(rows.map(row => row.article_id))
  }
}
