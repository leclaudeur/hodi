import { RESERVED_PREFIX, SqlRefused, checkPluginSql } from './sql-guard.ts'
import { SNAPSHOT_SUFFIX, type WasmDatabase, databasePath, loadSqliteWasm } from './sqlite-wasm.ts'
import { MAX_READ_BYTES, type SandboxData } from './protocol.ts'

// A plugin's own database, as its thread opens it (worker.ts): its ceiling, its migrations, and what Hodi reads of it.

export type PluginDatabase = WasmDatabase
export type SqlParam = string | number | null | Uint8Array

export const openDatabase = (data: SandboxData): PluginDatabase => {
  const { Database } = loadSqliteWasm(data.dbFile)
  const database = new Database(databasePath(data.dbFile))
  // Temporary tables and sorts stay in memory (counted in SQLite's heap), never in a file beside the database.
  database.exec('PRAGMA temp_store = MEMORY')
  // The file's ceiling: past it, a write fails with "database or disk is full". Set for this connection only, before
  // the plugin's SQL runs, which cannot change it (PRAGMA is refused).
  const pageSize = Number((database.get('PRAGMA page_size') as { page_size: number }).page_size)
  database.exec(`PRAGMA max_page_count = ${Math.floor(data.databaseBytes / pageSize)}`)
  database.exec(`CREATE TABLE IF NOT EXISTS ${RESERVED_PREFIX}migrations (step INTEGER PRIMARY KEY, ran_at INTEGER)`)
  return database
}

export const plainParams = (text: string) => {
  const params: unknown = JSON.parse(text)
  const valid = (value: unknown) => value === null || ['string', 'number', 'boolean'].includes(typeof value)
  if (!Array.isArray(params) || !params.every(valid)) throw new SqlRefused('invalid_params')
  return params.map(value => (typeof value === 'boolean' ? Number(value) : value)) as SqlParam[]
}

// Its migrations, each once, in its own database. Each is one statement the guard allows.
export const runMigrations = (database: PluginDatabase, migrations: string[]) => {
  const ran = new Set(
    (database.all(`SELECT step FROM ${RESERVED_PREFIX}migrations`) as { step: number }[]).map(row => row.step)
  )
  migrations.forEach((sql, step) => {
    if (ran.has(step)) return
    database.exec('BEGIN')
    try {
      database.run(checkPluginSql(sql))
      database.run(`INSERT INTO ${RESERVED_PREFIX}migrations (step, ran_at) VALUES (?, ?)`, [step, Date.now()])
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw new Error(`migration ${step}: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
}

// A value the core reads for a zip it builds: the first column of one row of a SELECT, as bytes of their own.
export const readBytes = (database: PluginDatabase, sql: string, params: string) => {
  const checked = checkPluginSql(sql)
  if (!/^\s*SELECT\b/i.test(checked)) throw new SqlRefused('not_a_select')
  const row = database.get(checked, plainParams(params)) as Record<string, unknown> | null | undefined
  const value = row ? Object.values(row)[0] : undefined
  const bytes = value instanceof Uint8Array ? value : typeof value === 'string' ? new TextEncoder().encode(value) : null
  if (!bytes) throw new Error('not_found')
  if (bytes.byteLength > MAX_READ_BYTES) throw new Error('too_large')
  return bytes.slice()
}

// A backup's copy of the database, made by Hodi, never by the plugin's SQL (the guard refuses VACUUM).
export const snapshotDatabase = (database: PluginDatabase, data: SandboxData) => {
  database.run('VACUUM INTO ?', [`${databasePath(data.dbFile)}${SNAPSHOT_SUFFIX}`])
}
