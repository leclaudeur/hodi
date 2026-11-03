import { readdirSync, rmSync, statSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { Database } from './database.ts'

const BACKUPS_KEPT = 7
const CHECK_INTERVAL_MS = 60 * 60 * 1000
const BACKUP_PREFIX = 'hodi-'
const BACKUP_FILE = /^hodi-.*\.db$/

// One copy per day, named by date: hodi-2026-10-24.db.
const backupName = (now: number) => `${BACKUP_PREFIX}${new Date(now).toISOString().slice(0, 10)}.db`

// Writes today's backup if it does not exist yet, and keeps only the last few.
export const backupDatabase = async (db: Database, dir: string, now: number) => {
  await mkdir(dir, { recursive: true })
  const existing = readdirSync(dir).filter(name => BACKUP_FILE.test(name))
  const name = backupName(now)

  if (!existing.includes(name)) {
    // A consistent copy, even while the app writes: SQLite takes care of it.
    db.prepare('VACUUM INTO ?').run(path.join(dir, name))
    existing.push(name)
  }

  existing
    .sort()
    .slice(0, -BACKUPS_KEPT)
    .forEach(old => rmSync(path.join(dir, old), { force: true }))
}

// The size of a file in bytes, 0 when it is not there (the WAL between checkpoints).
const sizeOf = (file: string) => {
  try {
    return statSync(file).size
  } catch {
    return 0
  }
}

// What the database and its backups take on the server's disk, for "Compte et données".
export const diskUsage = (databaseFile: string, backupDir: string) => {
  let backups: string[] = []
  try {
    backups = readdirSync(backupDir).filter(name => BACKUP_FILE.test(name))
  } catch {
    // No backup made yet.
  }
  return {
    databaseBytes: sizeOf(databaseFile) + sizeOf(`${databaseFile}-wal`),
    backupBytes: backups.reduce((total, name) => total + sizeOf(path.join(backupDir, name)), 0),
    backups: backups.length
  }
}

// Every hour: drop what is past its retention, and make the day's backup once.
export const startMaintenance = (
  { db, stores, backupDir }: { db: Database; stores: { prune: (now: number) => void }[]; backupDir: string },
  { now = Date.now, log = console.warn }: { now?: () => number; log?: (message: string) => void } = {}
) => {
  const run = async () => {
    try {
      stores.forEach(store => store.prune(now()))
      await backupDatabase(db, backupDir, now())
    } catch (error) {
      log(`Database maintenance failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  void run()
  const timer = setInterval(() => void run(), CHECK_INTERVAL_MS)
  timer.unref()
  return () => clearInterval(timer)
}
