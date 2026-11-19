import type { Language } from '../../shared/i18n.ts'
import type { Database } from './database.ts'

// Serveur › Notifications: every notice the server gave its admins, whatever way each chose to hear of it, so the
// page lists them all. A request someone waits on (a code asked for) carries a key, and stays « À traiter » until
// what it asks for is done; the same request is never listed twice while it waits.

export interface InboxTexts {
  from: string
  title: string
  text: string
}

export interface InboxItem {
  id: number
  type: string
  texts: Partial<Record<Language, InboxTexts>>
  url: string
  important: boolean
  createdAt: number
  handledAt: number | null
}

interface InboxRow {
  id: number
  type: string
  texts: string
  url: string
  important_key: string | null
  created_at: number
  handled_at: number | null
}

// The most notices kept: the oldest handled ones go first.
const MAX_ITEMS = 200

const toItem = (row: InboxRow): InboxItem => ({
  id: row.id,
  type: row.type,
  texts: JSON.parse(row.texts) as InboxItem['texts'],
  url: row.url,
  important: row.important_key !== null,
  createdAt: row.created_at,
  handledAt: row.handled_at
})

export class ServerInboxStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  // false: the same request already waits, and nothing is added.
  add(item: { type: string; texts: InboxItem['texts']; url: string; key?: string | null }, now: number): boolean {
    if (item.key && this.waiting(item.key) !== null) return false
    this.#db
      .prepare('INSERT INTO server_inbox (type, texts, url, important_key, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(item.type, JSON.stringify(item.texts), item.url, item.key ?? null, now)
    this.#db
      .prepare(
        `DELETE FROM server_inbox WHERE id IN (SELECT id FROM server_inbox WHERE important_key IS NULL OR handled_at
           IS NOT NULL ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET ?)`
      )
      .run(MAX_ITEMS)
    return true
  }

  // The newest first.
  list(limit = 50): InboxItem[] {
    return (
      this.#db
        .prepare('SELECT * FROM server_inbox ORDER BY created_at DESC, id DESC LIMIT ?')
        .all(limit) as unknown as InboxRow[]
    ).map(toItem)
  }

  // When the request with this key was made, while it waits.
  waiting(key: string): number | null {
    const row = this.#db
      .prepare('SELECT created_at FROM server_inbox WHERE important_key = ? AND handled_at IS NULL')
      .get(key) as { created_at: number } | undefined
    return row?.created_at ?? null
  }

  // The requests still waiting, by key, with when each was made.
  waitingAll(): Map<string, number> {
    const rows = this.#db
      .prepare(
        'SELECT important_key AS key, created_at FROM server_inbox WHERE important_key IS NOT NULL AND handled_at IS NULL'
      )
      .all() as { key: string; created_at: number }[]
    return new Map(rows.map(row => [row.key, row.created_at]))
  }

  // What the request asked for is done.
  handle(key: string, now: number) {
    this.#db
      .prepare('UPDATE server_inbox SET handled_at = ? WHERE important_key = ? AND handled_at IS NULL')
      .run(now, key)
  }
}
