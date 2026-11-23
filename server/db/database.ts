import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { HandleStore } from './handle-store.ts'
import { migrate } from './migrations.ts'
import { CONFIG } from '../fixed-config.ts'

export type Database = DatabaseSync

// Opens (or creates) the database and brings its schema up to date.
// ':memory:' gives a throwaway database, for tests.
export const openDatabase = (file: string): Database => {
  const inMemory = file === ':memory:'
  if (!inMemory) mkdirSync(path.dirname(file), { recursive: true })

  const db = new DatabaseSync(file)

  // WAL lets the reader's requests read while the background checks write.
  if (!inMemory) db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(`PRAGMA busy_timeout = ${CONFIG.database.busyTimeout}`)

  migrate(db)
  // The accounts made before identifiers existed get theirs.
  new HandleStore(db).fillMissing(Date.now())
  return db
}

// Runs fn in a transaction: everything is written, or nothing.
export const transaction = <T>(db: Database, fn: () => T): T => {
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
