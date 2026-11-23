import { CONFIG } from '../fixed-config.ts'
import { handleBase } from '../handle.ts'
import type { Database } from './database.ts'

const CHANGE_MS = CONFIG.accounts.handleChangeDays * 24 * 60 * 60 * 1000

export type HandleChange = 'changed' | 'unchanged' | 'taken' | 'too_soon'

// The accounts' @identifiers: free or taken, suggested from a name, changed once every 30 days at most.
export class HandleStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  // Free for anyone, or for this account: its own, and the one it left less than 30 days ago, are still its.
  isFree(handle: string, now: number, userId: number | null = null) {
    const owner = this.#db.prepare('SELECT id FROM users WHERE handle = ?').get(handle) as { id: number } | undefined
    if (owner && owner.id !== userId) return false
    const kept = this.#db
      .prepare('SELECT user_id FROM released_handles WHERE handle = ? AND until > ?')
      .get(handle, now) as { user_id: number } | undefined
    return !kept || kept.user_id === userId
  }

  // The text as an identifier, with the first number that makes it free: anthony, anthony2, anthony3...
  suggest(text: string, now: number, userId: number | null = null) {
    const base = handleBase(text)
    if (this.isFree(base, now, userId)) return base
    for (let count = 2; ; count++) {
      const candidate = `${base.slice(0, CONFIG.accounts.handleMaxLength - String(count).length)}${count}`
      if (this.isFree(candidate, now, userId)) return candidate
    }
  }

  // A new account's: the one it chose when free, or else one made from its e-mail.
  assign(userId: number, email: string, now: number, chosen: string | null = null) {
    const handle = chosen && this.isFree(chosen, now, userId) ? chosen : this.suggest(email.split('@')[0]!, now, userId)
    this.#db.prepare('UPDATE users SET handle = ? WHERE id = ?').run(handle, userId)
    return handle
  }

  // The accounts made before identifiers existed: their profile's name, or their e-mail.
  fillMissing(now: number) {
    const rows = this.#db
      .prepare(
        `SELECT users.id, users.email, (SELECT name FROM profiles WHERE user_id = users.id ORDER BY id DESC LIMIT 1) AS name
         FROM users WHERE handle IS NULL ORDER BY id`
      )
      .all() as { id: number; email: string | null; name: string | null }[]
    for (const row of rows) {
      // A young account always has its profile's name.
      const handle = this.suggest(row.name ?? row.email?.split('@')[0] ?? 'hodi', now, row.id)
      this.#db.prepare('UPDATE users SET handle = ? WHERE id = ?').run(handle, row.id)
    }
  }

  // « Modifier » in Mon compte: once every 30 days; the identifier left stays the account's for 30 days.
  change(userId: number, handle: string, now: number): HandleChange {
    const row = this.#db.prepare('SELECT handle, handle_changed_at FROM users WHERE id = ?').get(userId) as
      { handle: string | null; handle_changed_at: number | null } | undefined
    if (!row || row.handle === handle) return 'unchanged'
    if (row.handle_changed_at !== null && now - row.handle_changed_at < CHANGE_MS) return 'too_soon'
    if (!this.isFree(handle, now, userId)) return 'taken'
    this.#db.prepare('DELETE FROM released_handles WHERE until <= ? OR handle = ?').run(now, handle)
    if (row.handle) {
      this.#db
        .prepare('INSERT OR REPLACE INTO released_handles (handle, user_id, until) VALUES (?, ?, ?)')
        .run(row.handle, userId, now + CHANGE_MS)
    }
    this.#db.prepare('UPDATE users SET handle = ?, handle_changed_at = ? WHERE id = ?').run(handle, now, userId)
    return 'changed'
  }

  // When the identifier can change again; null: now.
  changeableFrom(userId: number, now: number) {
    const row = this.#db.prepare('SELECT handle_changed_at FROM users WHERE id = ?').get(userId) as
      { handle_changed_at: number | null } | undefined
    const from = row?.handle_changed_at === null || !row ? null : row.handle_changed_at + CHANGE_MS
    return from !== null && from > now ? from : null
  }
}
