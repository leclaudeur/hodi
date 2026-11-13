import type { Database } from './database.ts'
import { recordForget } from './forget-log.ts'
import { transaction } from './database.ts'
import { DEFAULT_ACCOUNT_ID } from './household-scope.ts'

// The households of the server as a plugin with permissions.households sees and makes them (ctx.households). The
// core makes one, at its setup; a plugin may make others. Only the plugin that made a household may suspend, resume
// or remove it: never the setup's, nor one made in Serveur › Foyers.

export interface StoredHousehold {
  id: number
  name: string
  language: string
  createdAt: number
  suspendedAt: number | null
  // The plugin that made it; null for the core's.
  madeByPlugin: string | null
  // null: no photo.
  photoVersion: number | null
}

interface HouseholdRow {
  id: number
  name: string
  language: string
  created_at: number
  suspended_at: number | null
  made_by_plugin: string | null
  photo_version: number | null
}

const toHousehold = (row: HouseholdRow): StoredHousehold => ({
  id: row.id,
  name: row.name,
  language: row.language,
  createdAt: row.created_at,
  suspendedAt: row.suspended_at,
  madeByPlugin: row.made_by_plugin,
  photoVersion: row.photo_version
})

const COLUMNS =
  'id, name, language, COALESCE(set_up_at, created_at) AS created_at, suspended_at, made_by_plugin, ' +
  'CASE WHEN photo IS NULL THEN NULL ELSE photo_version END AS photo_version'

export class PluginHouseholdStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  // Every household that is set up, the core's first.
  list(): StoredHousehold[] {
    const rows = this.#db
      .prepare(`SELECT ${COLUMNS} FROM accounts WHERE set_up_at IS NOT NULL ORDER BY id`)
      .all() as unknown as HouseholdRow[]
    return rows.map(toHousehold)
  }

  get(id: number): StoredHousehold | null {
    const row = this.#db.prepare(`SELECT ${COLUMNS} FROM accounts WHERE id = ? AND set_up_at IS NOT NULL`).get(id) as
      HouseholdRow | undefined
    return row ? toHousehold(row) : null
  }

  // The households where this account has a profile.
  of(accountId: number): StoredHousehold[] {
    const rows = this.#db
      .prepare(
        `SELECT ${COLUMNS} FROM accounts WHERE set_up_at IS NOT NULL
         AND id IN (SELECT account_id FROM profiles WHERE user_id = ?) ORDER BY id`
      )
      .all(accountId) as unknown as HouseholdRow[]
    return rows.map(toHousehold)
  }

  // A household set up at once, with its admin's profile: linked to an account, or waiting for a code.
  create(
    {
      name,
      language,
      plugin,
      admin
    }: { name: string; language: string; plugin: string; admin: { name: string; accountId: number | null } },
    now: number
  ): { household: StoredHousehold; adminProfileId: number } {
    return transaction(this.#db, () => {
      const { lastInsertRowid } = this.#db
        .prepare('INSERT INTO accounts (name, created_at, set_up_at, language, made_by_plugin) VALUES (?, ?, ?, ?, ?)')
        .run(name, now, now, language, plugin)
      const id = Number(lastInsertRowid)
      const profile = this.#db
        .prepare(
          `INSERT INTO profiles (account_id, name, color, kind, position, created_at, role, user_id, tour_pending)
           VALUES (?, ?, 'world', 'adult', 0, ?, 'admin', ?, 1)`
        )
        .run(id, admin.name, now, admin.accountId)
      return { household: this.get(id)!, adminProfileId: Number(profile.lastInsertRowid) }
    })
  }

  profileIds(id: number): number[] {
    const rows = this.#db.prepare('SELECT id FROM profiles WHERE account_id = ?').all(id) as { id: number }[]
    return rows.map(row => row.id)
  }

  // false when the household is not one this plugin made.
  setSuspended(id: number, plugin: string, at: number | null) {
    return (
      this.#db
        .prepare('UPDATE accounts SET suspended_at = ? WHERE id = ? AND made_by_plugin = ? AND id <> ?')
        .run(at, id, plugin, DEFAULT_ACCOUNT_ID).changes === 1
    )
  }

  // The household and everything of it (its profiles and what they did, its sources, its codes) go; the accounts of
  // its people stay, in no household or in their others. false when it is not one this plugin made.
  remove(id: number, plugin: string) {
    const row = this.#db
      .prepare('SELECT created_at AS createdAt FROM accounts WHERE id = ? AND made_by_plugin = ? AND id <> ?')
      .get(id, plugin, DEFAULT_ACCOUNT_ID) as { createdAt: number } | undefined
    if (!row) return false
    // Written down first, outside the database: a backup restored later removes it again (forget-log.ts).
    recordForget({ kind: 'household', id, createdAt: row.createdAt })
    this.#db.prepare('DELETE FROM accounts WHERE id = ?').run(id)
    return true
  }
}
