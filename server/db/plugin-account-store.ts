import type { Database } from './database.ts'

// Which plugin made an account (ctx.accounts.create) and whether that plugin suspended it: a plugin only ever
// suspends, resumes or removes the accounts it made, and a suspended account signs in nowhere.

export interface MadeAccount {
  madeByPlugin: string | null
  suspendedAt: number | null
}

export class PluginAccountStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  of(id: number): MadeAccount | null {
    const row = this.#db.prepare('SELECT made_by_plugin, suspended_at FROM users WHERE id = ?').get(id) as
      { made_by_plugin: string | null; suspended_at: number | null } | undefined
    return row ? { madeByPlugin: row.made_by_plugin, suspendedAt: row.suspended_at } : null
  }

  // The ids of the accounts this plugin made, newest first.
  madeBy(plugin: string): number[] {
    const rows = this.#db
      .prepare('SELECT id FROM users WHERE made_by_plugin = ? ORDER BY created_at DESC, id DESC')
      .all(plugin) as { id: number }[]
    return rows.map(row => row.id)
  }

  // Never the server's admin: a plugin cannot lock out the one person who can remove it.
  markMade(id: number, plugin: string) {
    this.#db.prepare('UPDATE users SET made_by_plugin = ? WHERE id = ? AND server_admin = 0').run(plugin, id)
  }

  // false when the account is not one this plugin made.
  setSuspended(id: number, plugin: string, at: number | null) {
    return (
      this.#db
        .prepare('UPDATE users SET suspended_at = ? WHERE id = ? AND made_by_plugin = ? AND server_admin = 0')
        .run(at, id, plugin).changes === 1
    )
  }
}
