import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { type Database, transaction } from './database.ts'
import { migrate } from './migrations.ts'

// Each installed plugin's state in the household: on or off, and the settings the admin chose. A plugin starts on: it
// was installed on purpose. Turning it off keeps its settings and its own tables.

type SqlValue = string | number | bigint | null | Uint8Array

export interface PluginState {
  enabled: boolean
  settings: Record<string, unknown>
}

interface Row {
  enabled: number
  settings: string
}

export interface Erasure {
  id: number
  pluginId: string
  hook: string
  subject: unknown
  householdId: number | null
  tries: number
}

// Hodi's own tables, from its migrations: never taken for a plugin's, whatever their name.
let coreTables: Set<string> | null = null
const isCoreTable = (name: string) => {
  if (!coreTables) {
    const fresh = new DatabaseSync(':memory:')
    migrate(fresh)
    coreTables = new Set(
      (fresh.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
        row => row.name
      )
    )
    fresh.close()
  }
  return coreTables.has(name)
}

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`

const parse = (text: string): Record<string, unknown> => {
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

export class PluginStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  // The plugin's state, with a row made the first time Hodi meets it.
  state(id: string, now: number): PluginState {
    this.#db
      .prepare('INSERT INTO plugins (id, enabled, settings, installed_at) VALUES (?, 1, ?, ?) ON CONFLICT DO NOTHING')
      .run(id, '{}', now)
    const row = this.#db.prepare('SELECT enabled, settings FROM plugins WHERE id = ?').get(id) as unknown as Row
    return { enabled: row.enabled === 1, settings: parse(row.settings) }
  }

  // Who the plugin's data belongs to; null before Hodi first recorded it.
  dataOwner(id: string): string | null {
    const row = this.#db.prepare('SELECT data_owner FROM plugins WHERE id = ?').get(id) as
      { data_owner: string | null } | undefined
    return row?.data_owner ?? null
  }

  setDataOwner(id: string, owner: string) {
    this.#db.prepare('UPDATE plugins SET data_owner = ? WHERE id = ?').run(owner, id)
  }

  // When each scheduled task of the plugin last started, in ms.
  taskRuns(id: string): Record<string, number> {
    const row = this.#db.prepare('SELECT task_runs FROM plugins WHERE id = ?').get(id) as
      { task_runs: string } | undefined
    const runs = parse(row?.task_runs ?? '{}')
    return Object.fromEntries(
      Object.entries(runs).filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    )
  }

  setTaskRun(id: string, task: string, at: number) {
    this.#db.prepare('UPDATE plugins SET task_runs = json_set(task_runs, ?, ?) WHERE id = ?').run(`$."${task}"`, at, id)
  }

  // A new owner gets none of the settings the previous one kept.
  clearSettings(id: string) {
    this.#db.prepare("UPDATE plugins SET settings = '{}' WHERE id = ?").run(id)
  }

  // Everything Hodi's database keeps for a plugin: its row and settings, its ways in, and the tables API 1 made in it.
  // The plugins whose AiButton a household's admin turned off (Réglages › IA et crédits).
  aiOff(householdId: number): Set<string> {
    const rows = this.#db.prepare('SELECT plugin_id FROM plugin_ai_off WHERE household_id = ?').all(householdId) as {
      plugin_id: string
    }[]
    return new Set(rows.map(row => row.plugin_id))
  }

  setAiOff(householdId: number, id: string, off: boolean) {
    if (off)
      this.#db
        .prepare('INSERT OR IGNORE INTO plugin_ai_off (household_id, plugin_id) VALUES (?, ?)')
        .run(householdId, id)
    else this.#db.prepare('DELETE FROM plugin_ai_off WHERE household_id = ? AND plugin_id = ?').run(householdId, id)
  }

  forget(id: string) {
    const tables = (
      this.#db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    ).filter(row => row.name.startsWith(`plugin_${id}_`) && !isCoreTable(row.name))
    transaction(this.#db, () => {
      // A virtual table first: dropping it drops its shadow tables, which then must not be dropped again.
      for (const { name } of tables) this.#db.exec(`DROP TABLE IF EXISTS ${quote(name)}`)
      this.#db.prepare('DELETE FROM plugin_migrations WHERE plugin_id = ?').run(id)
      // Its ways in to accounts (« Se connecter avec Google »): another plugin given the same id later must not
      // inherit them.
      this.#db.prepare('DELETE FROM account_logins WHERE plugin_id = ?').run(id)
      this.#db.prepare('DELETE FROM plugin_ai_off WHERE plugin_id = ?').run(id)
      // Its data is gone with it: nothing is left for it to forget.
      this.#db.prepare('DELETE FROM plugin_erasures WHERE plugin_id = ?').run(id)
      this.#db.prepare('DELETE FROM plugins WHERE id = ?').run(id)
    })
  }

  // Serveur › Plugins › Mode développeur. Turning it on makes a new code, shown once; only its hash is kept.
  startDevMode(now: number): string {
    const code = randomBytes(24).toString('base64url')
    this.#db
      .prepare('INSERT OR REPLACE INTO plugin_dev (id, code_hash, created_at) VALUES (1, ?, ?)')
      .run(hashOf(code), now)
    return code
  }

  // Off: the code stops working, and the plugins it installed are plain unsigned ones again.
  stopDevMode() {
    transaction(this.#db, () => {
      this.#db.prepare('DELETE FROM plugin_dev').run()
      this.#db.prepare('UPDATE plugins SET dev = 0').run()
    })
  }

  devMode(): boolean {
    return this.#db.prepare('SELECT 1 FROM plugin_dev').get() !== undefined
  }

  // Whether a code is the one the mode made, compared in constant time.
  isDevCode(code: string): boolean {
    const row = this.#db.prepare('SELECT code_hash FROM plugin_dev').get() as { code_hash: string } | undefined
    if (!row) return false
    const given = Buffer.from(hashOf(code))
    const kept = Buffer.from(row.code_hash)
    return given.length === kept.length && timingSafeEqual(given, kept)
  }

  // A plugin « npx hodi-plugin dev » installed: while the mode is on, its web part runs although it is unsigned.
  // The plugins Hodi keeps something of: a row, loaded or not, removed with its data kept or not.
  ids(): string[] {
    return (this.#db.prepare('SELECT id FROM plugins ORDER BY id').all() as { id: string }[]).map(row => row.id)
  }

  // Removed with its data kept (a time), or back (null).
  setRemoved(id: string, at: number | null) {
    this.#db.prepare('UPDATE plugins SET removed_at = ? WHERE id = ?').run(at, id)
  }

  // The plugins whose code is gone but whose row stays, with no removal time yet (removed before Hodi kept one, or by
  // hand): their 30 days start now.
  markGone(installed: string[], now: number) {
    const ids = this.ids().filter(id => !installed.includes(id))
    const mark = this.#db.prepare('UPDATE plugins SET removed_at = ? WHERE id = ? AND removed_at IS NULL')
    for (const id of ids) mark.run(now, id)
  }

  // The plugins removed with their data kept, at that time or before.
  removedBefore(at: number): string[] {
    return (
      this.#db.prepare('SELECT id FROM plugins WHERE removed_at IS NOT NULL AND removed_at <= ?').all(at) as {
        id: string
      }[]
    ).map(row => row.id)
  }

  // A deletion a plugin must hear of: its hook, and what it is told (a profile, an account or a household).
  addErasure(pluginId: string, hook: string, subject: unknown, householdId: number | null, now: number) {
    this.#db
      .prepare(
        'INSERT INTO plugin_erasures (plugin_id, hook, subject, household_id, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(pluginId, hook, JSON.stringify(subject), householdId, now)
  }

  // The deletions due now, oldest first.
  erasures(now = Number.MAX_SAFE_INTEGER): Erasure[] {
    return (
      this.#db
        .prepare(
          'SELECT id, plugin_id, hook, subject, household_id, tries FROM plugin_erasures WHERE next_try_at <= ? ORDER BY id'
        )
        .all(now) as {
        id: number
        plugin_id: string
        hook: string
        subject: string
        household_id: number | null
        tries: number
      }[]
    ).map(row => ({
      id: row.id,
      pluginId: row.plugin_id,
      hook: row.hook,
      subject: JSON.parse(row.subject) as unknown,
      householdId: row.household_id,
      tries: row.tries
    }))
  }

  // The plugin answered: done.
  erasureDone(id: number) {
    this.#db.prepare('DELETE FROM plugin_erasures WHERE id = ?').run(id)
  }

  // It failed: asked again in a minute, ten times, then every hour.
  erasureFailed(id: number, now: number) {
    this.#db
      .prepare(
        `UPDATE plugin_erasures SET tries = tries + 1,
         next_try_at = ? + CASE WHEN tries + 1 < 10 THEN 60000 ELSE 3600000 END WHERE id = ?`
      )
      .run(now, id)
  }

  isDev(id: string): boolean {
    const row = this.#db.prepare('SELECT dev FROM plugins WHERE id = ?').get(id) as { dev: number } | undefined
    return row?.dev === 1 && this.devMode()
  }

  setDev(id: string, now: number) {
    this.state(id, now)
    this.#db.prepare('UPDATE plugins SET dev = 1 WHERE id = ?').run(id)
  }

  setEnabled(id: string, enabled: boolean) {
    this.#db.prepare('UPDATE plugins SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id)
  }

  // Merges the checked values into what is stored.
  updateSettings(id: string, values: Record<string, unknown>) {
    transaction(this.#db, () => {
      const row = this.#db.prepare('SELECT settings FROM plugins WHERE id = ?').get(id) as unknown as
        Pick<Row, 'settings'> | undefined
      if (!row) return
      const settings = { ...parse(row.settings), ...values }
      this.#db.prepare('UPDATE plugins SET settings = ? WHERE id = ?').run(JSON.stringify(settings), id)
    })
  }

  // Applies the plugin's own migrations it has not applied yet, each in a transaction with the record of it, so a
  // failing step leaves nothing half done and is tried again on the next start.
  migrate(id: string, steps: readonly string[], now: number) {
    const done = this.#db
      .prepare('SELECT COALESCE(MAX(step), 0) AS last FROM plugin_migrations WHERE plugin_id = ?')
      .get(id) as unknown as { last: number }

    steps.slice(done.last).forEach((sql, index) => {
      transaction(this.#db, () => {
        this.#db.exec(sql)
        this.#db
          .prepare('INSERT INTO plugin_migrations (plugin_id, step, applied_at) VALUES (?, ?, ?)')
          .run(id, done.last + index + 1, now)
      })
    })
  }

  // API 1 plugins kept their tables in Hodi's database, named plugin_<id>_…. The first time such a plugin starts with a
  // database of its own (file not made yet), its tables and their rows are copied there, with their indexes, so that
  // its migrations find them. Hodi's copy stays as it was. A virtual table (FTS) and its shadow tables are left out:
  // the plugin's migration builds its index again. Returns the tables copied and those left out.
  copyLegacyTables(id: string, file: string): { copied: number; skipped: string[] } {
    if (existsSync(file)) return { copied: 0, skipped: [] }
    const prefix = `plugin_${id}_`
    const schema = this.#db
      .prepare(
        "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('table', 'index') AND sql IS NOT NULL"
      )
      .all() as { type: string; name: string; tbl_name: string; sql: string }[]
    const own = schema.filter(row => row.type === 'table' && row.name.startsWith(prefix) && !isCoreTable(row.name))
    const virtual = own.filter(row => /^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(row.sql)).map(row => row.name)
    const isSkipped = (name: string) => virtual.some(table => name === table || name.startsWith(`${table}_`))
    const tables = own.filter(row => !isSkipped(row.name))
    const skipped = own.filter(row => isSkipped(row.name)).map(row => row.name)
    if (tables.length === 0) return { copied: 0, skipped }
    const copied = new Set(tables.map(table => table.name))
    const target = new DatabaseSync(file)
    try {
      target.exec('BEGIN')
      for (const table of tables) {
        target.exec(table.sql)
        const columns = (this.#db.prepare(`PRAGMA table_info(${quote(table.name)})`).all() as { name: string }[]).map(
          column => column.name
        )
        const insert = target.prepare(
          `INSERT INTO ${quote(table.name)} (${columns.map(quote).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
        )
        for (const row of this.#db.prepare(`SELECT * FROM ${quote(table.name)}`).iterate()) {
          insert.run(...columns.map(column => (row as Record<string, SqlValue>)[column] ?? null))
        }
      }
      for (const index of schema.filter(row => row.type === 'index' && copied.has(row.tbl_name))) {
        target.exec(index.sql)
      }
      target.exec('COMMIT')
    } catch (error) {
      // Half a copy is no copy: the next start tries again.
      target.close()
      rmSync(file, { force: true })
      throw error
    }
    target.close()
    return { copied: tables.length, skipped }
  }
}

const hashOf = (code: string) => createHash('sha256').update(code).digest('hex')
