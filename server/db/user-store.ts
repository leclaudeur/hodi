import type { AlertSettings } from '../news/followed-alerts.ts'
import { type Database, transaction } from './database.ts'
import {
  firstReadingAt,
  insertReadings,
  readingsBySource,
  readingsOf,
  resumableReadings,
  updateReadingRow
} from './reading-queries.ts'
import { listPushSubscriptions, removePushSubscription, savePushSubscription } from './push-subscriptions.ts'
import { type ImportedState, importStateRows } from './state-import.ts'
import { markReactionsSeen, react, reactions, shareTo, shares } from './share-queries.ts'

// A profile's own state, shared by every device it is open on. The household has one password and up to
// five profiles (see profile-store.ts); until the app chooses one, everything is the first profile's.

export const DEFAULT_PROFILE_ID = 1

// A card as the app showed it: kept as is, the server only checks its id.
export type SavedItem = Record<string, unknown> & { id: string }

// Reader text kept with a saved article that the feeds and the store may no longer have.
export interface SavedArticleText {
  title: string | null
  byline: string | null
  contentHtml: string
}

export interface SavedEntry {
  item: SavedItem
  savedAt: string
}

export interface Reading {
  id: string
  sourceId: string
  sourceName: string
  topicId: string | null
  minutes: number
  // When the article was first opened (ms).
  at: number
  kind: ReadingKind
  // Articles opened since it was tracked. Left out: counted as read.
  done?: boolean
  // How far the text went (0 to 1), and where it was left.
  progress?: number
  position?: number
  // Estimated minutes; minutes is then the time really spent.
  estimate?: number
}

// What a reader sends while an article is open: never less than before, but the position it was left at.
export interface ReadingProgress {
  minutes: number
  progress: number
  position: number
  done: boolean
  // A video's or an episode's length in minutes, once its player knows it.
  estimate?: number
}

export const READING_KINDS = ['article', 'video', 'podcast'] as const
export type ReadingKind = (typeof READING_KINDS)[number]

export interface UserState {
  // Bumped on every change: a device that already has this revision has nothing to fetch.
  revision: number
  preferences: Record<string, unknown> | null
  saved: SavedEntry[]
  // Newest first.
  read: string[]
  // Read articles hidden from the lists without being opened.
  hidden: string[]
  readings: Reading[]
}

export const MAX_SAVED = 500
export const MAX_READ = 5000
const READ_RETENTION_MS = 365 * 24 * 60 * 60 * 1000
export const READINGS_RETENTION_MS = 400 * 24 * 60 * 60 * 1000
// "Partages" keeps what was sent for a week.
export const SHARES_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
// "À la une" covers a day: a seen story is kept a little longer, for the stories that last.
export const SEEN_STORIES_RETENTION_MS = 3 * 24 * 60 * 60 * 1000

export class UserStore {
  readonly #db: Database
  readonly #profile: number

  constructor(db: Database, profileId = DEFAULT_PROFILE_ID) {
    this.#db = db
    this.#profile = profileId
  }

  get profileId() {
    return this.#profile
  }

  get revision(): number {
    const row = this.#db
      .prepare("SELECT value FROM profile_settings WHERE profile_id = ? AND key = 'revision'")
      .get(this.#profile) as { value: string } | undefined
    return row ? Number(row.value) : 0
  }

  #bump(now: number) {
    this.#db
      .prepare(
        `INSERT INTO profile_settings (profile_id, key, value, updated_at) VALUES (?, 'revision', '1', ?)
         ON CONFLICT (profile_id, key) DO UPDATE SET value = CAST(value AS INTEGER) + 1, updated_at = excluded.updated_at`
      )
      .run(this.#profile, now)
  }

  // Every write goes through here: one transaction, one new revision.
  #write(now: number, fn: () => void) {
    transaction(this.#db, () => {
      fn()
      this.#bump(now)
    })
    return this.revision
  }

  // This profile's preferences alone, without the rest of its state.
  preferences(): Record<string, unknown> | null {
    const row = this.#db
      .prepare("SELECT value FROM profile_settings WHERE profile_id = ? AND key = 'preferences'")
      .get(this.#profile) as { value: string } | undefined
    return row ? (JSON.parse(row.value) as Record<string, unknown>) : null
  }

  // The sources this profile turned off in Réglages > Sources.
  hiddenSources(): string[] {
    const hidden = this.preferences()?.hiddenSources
    return Array.isArray(hidden) ? hidden.filter((id): id is string => typeof id === 'string') : []
  }

  getState(): UserState {
    const preferences = this.#db
      .prepare("SELECT value FROM profile_settings WHERE profile_id = ? AND key = 'preferences'")
      .get(this.#profile) as { value: string } | undefined
    const saved = this.#db
      .prepare('SELECT item, saved_at FROM saved_articles WHERE profile_id = ? ORDER BY saved_at DESC')
      .all(this.#profile) as {
      item: string
      saved_at: number
    }[]
    const read = this.#db
      .prepare('SELECT article_id, hidden FROM read_articles WHERE profile_id = ? ORDER BY read_at DESC LIMIT ?')
      .all(this.#profile, MAX_READ) as { article_id: string; hidden: number }[]
    return {
      revision: this.revision,
      preferences: preferences ? (JSON.parse(preferences.value) as Record<string, unknown>) : null,
      saved: saved.map(row => ({
        item: JSON.parse(row.item) as SavedItem,
        savedAt: new Date(row.saved_at).toISOString()
      })),
      read: read.map(row => row.article_id),
      hidden: read.filter(row => row.hidden === 1).map(row => row.article_id),
      readings: readingsOf(this.#db, this.#profile)
    }
  }

  // Only the keys sent change: a device with an older copy can't wipe out what another one set.
  setPreferences(change: Record<string, unknown>, now: number) {
    return this.#write(now, () => {
      const stored = this.#db
        .prepare("SELECT value FROM profile_settings WHERE profile_id = ? AND key = 'preferences'")
        .get(this.#profile) as { value: string } | undefined
      const preferences = { ...(stored ? (JSON.parse(stored.value) as Record<string, unknown>) : {}), ...change }
      this.#db
        .prepare(
          `INSERT INTO profile_settings (profile_id, key, value, updated_at) VALUES (?, 'preferences', ?, ?)
           ON CONFLICT (profile_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
        )
        .run(this.#profile, JSON.stringify(preferences), now)
    })
  }

  // Saving again keeps the first date and the text already kept.
  save(item: SavedItem, article: SavedArticleText | null, savedAt: number, now: number) {
    return this.#write(now, () => {
      this.#db
        .prepare(
          `INSERT INTO saved_articles (profile_id, article_id, item, article, saved_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (profile_id, article_id) DO UPDATE SET
             item = excluded.item, article = COALESCE(excluded.article, article)`
        )
        .run(this.#profile, item.id, JSON.stringify(item), article ? JSON.stringify(article) : null, savedAt)
      // Beyond the cap, the oldest go.
      this.#db
        .prepare(
          `DELETE FROM saved_articles WHERE profile_id = ? AND article_id NOT IN
           (SELECT article_id FROM saved_articles WHERE profile_id = ? ORDER BY saved_at DESC LIMIT ?)`
        )
        .run(this.#profile, this.#profile, MAX_SAVED)
    })
  }

  unsave(id: string, now: number) {
    return this.#write(now, () => {
      this.#db.prepare('DELETE FROM saved_articles WHERE profile_id = ? AND article_id = ?').run(this.#profile, id)
    })
  }

  isSaved(id: string) {
    return (
      this.#db
        .prepare('SELECT 1 FROM saved_articles WHERE profile_id = ? AND article_id = ?')
        .get(this.#profile, id) !== undefined
    )
  }

  // Whether another profile ever sent it this article, read since or not.
  wasSharedWith(id: string) {
    return (
      this.#db.prepare('SELECT 1 FROM shares WHERE profile_id = ? AND article_id = ?').get(this.#profile, id) !==
      undefined
    )
  }

  // The text kept with a saved article, for one the server no longer knows.
  savedArticle(id: string): { item: SavedItem; article: SavedArticleText } | null {
    const row = this.#db
      .prepare(
        'SELECT item, article FROM saved_articles WHERE profile_id = ? AND article_id = ? AND article IS NOT NULL'
      )
      .get(this.#profile, id) as { item: string; article: string } | undefined
    return row
      ? { item: JSON.parse(row.item) as SavedItem, article: JSON.parse(row.article) as SavedArticleText }
      : null
  }

  // hidden: put away without being opened. An article already read keeps the day it was read.
  // A shared article read stays in "Partages" (the app hides it under "Masquer les articles lus", as everywhere);
  // put away, it leaves until it is marked unread again from the history.
  markRead(ids: string[], now: number, hidden = false) {
    return this.#write(now, () => {
      const insert = this.#db.prepare(
        `INSERT INTO read_articles (profile_id, article_id, read_at, hidden) VALUES (?, ?, ?, ?)
         ON CONFLICT (profile_id, article_id) DO UPDATE SET hidden = MAX(hidden, excluded.hidden)`
      )
      ids.forEach(id => insert.run(this.#profile, id, now, hidden ? 1 : 0))
    })
  }

  markUnread(ids: string[], now: number) {
    return this.#write(now, () => {
      const remove = this.#db.prepare('DELETE FROM read_articles WHERE profile_id = ? AND article_id = ?')
      ids.forEach(id => remove.run(this.#profile, id))
    })
  }

  clearRead(now: number) {
    return this.#write(now, () => {
      this.#db.prepare('DELETE FROM read_articles WHERE profile_id = ?').run(this.#profile)
    })
  }

  // "Historique": the articles marked read since then, last read first.
  readSince(since: number, limit: number): { id: string; readAt: number; hidden: boolean }[] {
    const rows = this.#db
      .prepare(
        `SELECT article_id, read_at, hidden FROM read_articles WHERE profile_id = ? AND read_at >= ?
         ORDER BY read_at DESC LIMIT ?`
      )
      .all(this.#profile, since, limit) as { article_id: string; read_at: number; hidden: number }[]
    return rows.map(row => ({ id: row.article_id, readAt: row.read_at, hidden: row.hidden === 1 }))
  }

  // "Reprendre": articles, videos and episodes started but not read or seen for good, newest first, that were not
  // taken off it. An article scrolled past maxProgress without the time to read it was skimmed to its end: nothing
  // left to pick up there.
  resumable(since: number, minProgress: number, maxProgress: number, limit: number) {
    return resumableReadings(this.#db, this.#profile, { since, minProgress, maxProgress, limit })
  }

  setAside(id: string, now: number) {
    return this.#write(now, () => {
      this.#db
        .prepare('UPDATE readings SET set_aside = 1 WHERE profile_id = ? AND article_id = ?')
        .run(this.#profile, id)
    })
  }

  // Sends an article to another profile's "Partages", with a word or not. Sent again, it comes back on top with
  // the new word, unread and without the reaction to the last time.
  shareTo(profileId: number, item: { id: string }, now: number, note: string | null = null) {
    shareTo(this.#db, this.#profile, profileId, item, now, note)
  }

  // What the other profiles sent here this week, read or not, newest first, without the articles put away.
  shares(since: number) {
    return shares(this.#db, this.#profile, since)
  }

  // An emoji back to whoever sent the article, read or not; null takes it back.
  react(articleId: string, from: number, reaction: string | null, now: number) {
    return react(this.#db, this.#profile, articleId, from, reaction, now)
  }

  // The reactions to what this profile sent that it has not seen yet, newest first.
  reactions() {
    return reactions(this.#db, this.#profile)
  }

  markReactionsSeen(until: number) {
    markReactionsSeen(this.#db, this.#profile, until)
  }

  // "À la une" stories looked at. Seeing one is not reading it: it only steps aside for the next.
  markStoriesSeen(ids: string[], now: number) {
    const insert = this.#db.prepare(
      'INSERT OR IGNORE INTO seen_stories (profile_id, article_id, seen_at) VALUES (?, ?, ?)'
    )
    transaction(this.#db, () => ids.forEach(id => insert.run(this.#profile, id, now)))
  }

  // The stories seen and the articles read or hidden since then: what "À la une" puts after the rest.
  knownSince(since: number): Set<string> {
    const rows = this.#db
      .prepare(
        `SELECT article_id FROM seen_stories WHERE profile_id = ? AND seen_at >= ?
         UNION SELECT article_id FROM read_articles WHERE profile_id = ? AND read_at >= ?`
      )
      .all(this.#profile, since, this.#profile, since) as { article_id: string }[]
    return new Set(rows.map(row => row.article_id))
  }

  // When this profile first opened something, or null.
  firstReadingAt() {
    return firstReadingAt(this.#db, this.#profile)
  }

  // Articles and videos opened since then, by source.
  readingsBySource(since: number) {
    return readingsBySource(this.#db, this.#profile, since)
  }

  // Each article counts once, on the day it was first opened.
  addReadings(readings: Reading[], now: number) {
    return this.#write(now, () => insertReadings(this.#db, this.#profile, readings))
  }

  // Nothing for an entry not tracked (a video, or one from before): it stays counted as read.
  updateReading(id: string, change: ReadingProgress, now: number) {
    return this.#write(now, () => updateReadingRow(this.#db, this.#profile, id, change))
  }

  clearReadings(now: number) {
    return this.#write(now, () => {
      this.#db.prepare('DELETE FROM readings WHERE profile_id = ?').run(this.#profile)
    })
  }

  // What a device kept before the database existed joins what is here; nothing here is replaced.
  importState(incoming: ImportedState, now: number) {
    return this.#write(now, () => importStateRows(this.#db, this.#profile, incoming, now))
  }

  // Every device's, whatever its profile: the alerts are sent from one place.
  listPushSubscriptions() {
    return listPushSubscriptions(this.#db)
  }

  savePushSubscription(settings: AlertSettings, now: number) {
    savePushSubscription(this.#db, settings.profileId ?? this.#profile, settings, now)
  }

  removePushSubscription(endpoint: string) {
    removePushSubscription(this.#db, endpoint)
  }

  // For every profile at once.
  prune(now: number) {
    transaction(this.#db, () => {
      this.#db.prepare('DELETE FROM read_articles WHERE read_at < ?').run(now - READ_RETENTION_MS)
      // Each profile keeps its last MAX_READ.
      this.#db
        .prepare(
          `DELETE FROM read_articles WHERE rowid IN (SELECT rowid FROM (SELECT rowid, ROW_NUMBER() OVER
           (PARTITION BY profile_id ORDER BY read_at DESC) AS n FROM read_articles) WHERE n > ?)`
        )
        .run(MAX_READ)
      this.#db.prepare('DELETE FROM readings WHERE read_at < ?').run(now - READINGS_RETENTION_MS)
      this.#db.prepare('DELETE FROM seen_stories WHERE seen_at < ?').run(now - SEEN_STORIES_RETENTION_MS)
      this.#db.prepare('DELETE FROM shares WHERE shared_at < ?').run(now - SHARES_RETENTION_MS)
    })
  }
}
