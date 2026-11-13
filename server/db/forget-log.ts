import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { type Database, transaction } from './database.ts'
import { DEFAULT_ACCOUNT_ID } from './household-scope.ts'

// What was deleted of people, kept outside Hodi's database (data/forgotten.jsonl) so that « Restaurer » cannot bring it
// back: a copy made before a deletion still holds the person, and after the copy takes the database's place, every
// deletion since is done again. Only ids and times: nothing that says who the person was.

// Each row is named by its id and its creation time: SQLite may give a deleted row's id to a new one, never both.
export interface RowKey {
  id: number
  createdAt: number
}

export type ForgetEntry =
  // A profile deleted, with its household (its sources, readings and the rest go with it).
  | ({ kind: 'profile'; householdId: number } & RowKey)
  // An account deleted (users row).
  | ({ kind: 'account' } & RowKey)
  // A household a plugin removed, with all of it.
  | ({ kind: 'household' } & RowKey)
  // The core's household emptied with its last adult's account: these profiles and accounts went, and it was left as
  // a new install's.
  | ({ kind: 'householdReset'; profiles: RowKey[]; accounts: RowKey[] } & RowKey)
  // Who took over when the person held a role: the household's admin (a profile), the server's admin (an account).
  | ({ kind: 'admin' } & RowKey)
  | ({ kind: 'serverAdmin' } & RowKey)

export type ForgetRecord = ForgetEntry & { at: number }

// A deletion this close before a copy was made may be missing from it (the copy reads the database as it starts):
// it is done again too. Doing one again that the copy already has changes nothing.
export const FORGET_MARGIN_MS = 5 * 60 * 1000

export class ForgetLog {
  readonly #file: string
  readonly #now: () => number
  readonly #oldestCopy: () => number | null
  readonly #log: (line: string) => void

  // oldestCopy: when the oldest copy that could be restored was made (null: none), for pruning.
  constructor(
    file: string,
    {
      now = Date.now,
      oldestCopy,
      log = console.warn
    }: { now?: () => number; oldestCopy: () => number | null; log?: (line: string) => void }
  ) {
    this.#file = file
    this.#now = now
    this.#oldestCopy = oldestCopy
    this.#log = log
  }

  record(entry: ForgetEntry) {
    appendFileSync(this.#file, `${JSON.stringify({ ...entry, at: this.#now() })}\n`)
  }

  all(): ForgetRecord[] {
    if (!existsSync(this.#file)) return []
    return readFileSync(this.#file, 'utf8')
      .split('\n')
      .filter(line => line.trim() !== '')
      .flatMap(line => {
        const entry = parseRecord(line)
        // A line cut by a crash, or changed by hand: never trusted.
        if (!entry) this.#log(`A line of ${path.basename(this.#file)} cannot be read: it is skipped`)
        return entry ? [entry] : []
      })
  }

  // The deletions a copy made at `at` may lack, in the order they were made.
  since(at: number) {
    return this.all().filter(entry => entry.at >= at - FORGET_MARGIN_MS)
  }

  // Only what an existing copy could bring back is kept: older lines go with the copies.
  prune() {
    const oldest = this.#oldestCopy()
    const kept = oldest === null ? [] : this.since(oldest)
    if (kept.length === this.all().length) return
    writeFileSync(`${this.#file}.part`, kept.map(entry => `${JSON.stringify(entry)}\n`).join(''))
    renameSync(`${this.#file}.part`, this.#file)
  }
}

// The log the stores write to: set once at start (start.ts), none in tests that do not need it.
let current: ForgetLog | null = null
export const setForgetLog = (log: ForgetLog | null) => {
  current = log
}
export const recordForget = (entry: ForgetEntry) => current?.record(entry)

// Does the deletions again on a restored database, before anything else reads it. Each one only acts on what is still
// there, so doing one the copy already had changes nothing.
export const replayForgotten = (db: Database, entries: ForgetRecord[], now: number) =>
  transaction(db, () => {
    const remove = (table: 'profiles' | 'users' | 'accounts', key: RowKey) =>
      // The core's own household is never removed, only reset.
      table === 'accounts' && key.id === DEFAULT_ACCOUNT_ID
        ? 0
        : Number(db.prepare(`DELETE FROM ${table} WHERE id = ? AND created_at = ?`).run(key.id, key.createdAt).changes)
    for (const entry of entries) {
      switch (entry.kind) {
        case 'profile':
          remove('profiles', entry)
          break
        case 'account':
          remove('users', entry)
          break
        case 'household':
          remove('accounts', entry)
          break
        case 'householdReset': {
          const gone = entry.profiles.reduce((count, key) => count + remove('profiles', key), 0)
          entry.accounts.forEach(key => remove('users', key))
          // The copy had the household as it was: it is left as a new install's again.
          const same = db
            .prepare('SELECT 1 FROM accounts WHERE id = ? AND created_at = ?')
            .get(entry.id, entry.createdAt)
          if (gone > 0 && same) resetHousehold(db, entry.id, now)
          break
        }
        case 'admin':
          db.prepare("UPDATE profiles SET role = 'admin' WHERE id = ? AND created_at = ?").run(
            entry.id,
            entry.createdAt
          )
          break
        case 'serverAdmin':
          db.prepare('UPDATE users SET server_admin = 1 WHERE id = ? AND created_at = ?').run(entry.id, entry.createdAt)
          break
      }
    }
  })

// The key of a row about to go, for the log: null when it is not there.
export const rowKey = (db: Database, table: 'profiles' | 'users' | 'accounts', id: number): RowKey | null => {
  const row = db.prepare(`SELECT created_at AS createdAt FROM ${table} WHERE id = ?`).get(id) as
    { createdAt: number } | undefined
  return row ? { id, createdAt: row.createdAt } : null
}

const isInteger = (value: unknown): value is number => Number.isSafeInteger(value)
const isKey = (value: unknown): value is RowKey =>
  typeof value === 'object' &&
  value !== null &&
  isInteger((value as RowKey).id) &&
  isInteger((value as RowKey).createdAt)

// One line of the log, checked: its kind, and every id and time a whole number.
const parseRecord = (line: string): ForgetRecord | null => {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return null
  }
  if (!isKey(value) || !isInteger((value as { at?: unknown }).at)) return null
  const entry = value as ForgetRecord
  switch (entry.kind) {
    case 'profile':
      return isInteger(entry.householdId) ? entry : null
    case 'householdReset':
      return Array.isArray(entry.profiles) &&
        entry.profiles.every(isKey) &&
        Array.isArray(entry.accounts) &&
        entry.accounts.every(isKey)
        ? entry
        : null
    case 'account':
    case 'household':
    case 'admin':
    case 'serverAdmin':
      return entry
    default:
      return null
  }
}

// A household emptied of its people: its first-run screens come back, with one first profile to give the next admin.
export const resetHousehold = (db: Database, householdId: number, now: number) => {
  db.prepare('DELETE FROM profiles WHERE account_id = ?').run(householdId)
  db.prepare(
    `INSERT INTO profiles (account_id, name, color, position, created_at, role) VALUES (?, 'Admin', 'world', 0, ?, 'admin')`
  ).run(householdId, now)
  db.prepare(
    `UPDATE accounts SET name = 'Foyer', set_up_at = NULL, password_hash = NULL, password_changed_at = NULL,
     ai_provider = NULL, ai_key = NULL, ai_model = NULL, parental_pin_hash = NULL,
     session_generation = session_generation + 1 WHERE id = ?`
  ).run(householdId)
}
