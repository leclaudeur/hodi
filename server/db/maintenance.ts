import {
  closeSync,
  copyFileSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync
} from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { Database } from './database.ts'
import { type PluginSnapshots, backupPluginData, pluginCopyBytes, pluginCopyDir } from './plugin-backup.ts'

// Serveur › Sauvegardes changes it (1 to 30 copies).
export const BACKUPS_KEPT = 7
const CHECK_INTERVAL_MS = 60 * 60 * 1000
const BACKUP_PREFIX = 'hodi-'
export const BACKUP_FILE = /^hodi-[\d-]+\.db$/

// One copy per day, named by date: hodi-2026-10-24.db. One made by hand has its time too: hodi-2026-10-24-153012.db.
const backupName = (now: number) => `${BACKUP_PREFIX}${new Date(now).toISOString().slice(0, 10)}.db`
const manualName = (now: number) =>
  `${BACKUP_PREFIX}${new Date(now).toISOString().slice(0, 19).replace('T', '-').replaceAll(':', '')}.db`

// The size of a file in bytes, 0 when it is not there (the WAL between checkpoints).
const sizeOf = (file: string) => {
  try {
    return statSync(file).size
  } catch {
    return 0
  }
}

const modifiedAt = (file: string) => {
  try {
    return statSync(file).mtimeMs
  } catch {
    return 0
  }
}

// The copies in the folder, the newest first: its name, when it was made and its size.
export const listBackups = (dir: string) => {
  let names: string[] = []
  try {
    names = readdirSync(dir).filter(name => BACKUP_FILE.test(name))
  } catch {
    // No backup made yet.
  }
  return names
    .map(name => {
      const file = path.join(dir, name)
      return { name, at: modifiedAt(file), bytes: sizeOf(file) + pluginCopyBytes(file) }
    })
    .sort((a, b) => b.at - a.at || b.name.localeCompare(a.name))
}

// Only the last `kept` copies stay, whoever made them, with their plugins' copies. A plugins' folder whose core copy
// is gone goes too.
export const pruneBackups = (dir: string, kept: number) => {
  listBackups(dir)
    .slice(kept)
    .forEach(old => {
      rmSync(path.join(dir, old.name), { force: true })
      rmSync(pluginCopyDir(path.join(dir, old.name)), { recursive: true, force: true })
    })
  let names: string[] = []
  try {
    names = readdirSync(dir)
  } catch {
    return
  }
  for (const name of names) {
    const core = name.replace(/\.plugins$/, '.db')
    if (core !== name && !names.includes(core)) {
      rmSync(path.join(dir, name), { recursive: true, force: true })
    }
  }
}

// The plugins' data in each copy: where it lives, and what runs the plugins now (null before they load).
export interface PluginBackup {
  dataDir: string
  snapshots: () => PluginSnapshots | null
  log?: (line: string) => void
}

// The plugins' copies of the same moment, beside the core's. Written aside first: a folder with its manifest is whole.
// If it fails, the core's copy stays alone, and a restore leaves the plugins' data as it is.
const backupPlugins = async (file: string, plugins: PluginBackup | undefined) => {
  if (!plugins) return
  const log = plugins.log ?? console.warn
  const dir = pluginCopyDir(file)
  try {
    await backupPluginData(plugins.dataDir, `${dir}.part`, plugins.snapshots(), log)
    rmSync(dir, { recursive: true, force: true })
    renameSync(`${dir}.part`, dir)
  } catch (error) {
    rmSync(`${dir}.part`, { recursive: true, force: true })
    log(`The plugins' data is not in ${path.basename(file)}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// Writes today's backup if it does not exist yet, and keeps only the last few.
export const backupDatabase = async (
  db: Database,
  dir: string,
  now: number,
  kept = BACKUPS_KEPT,
  plugins?: PluginBackup
) => {
  await mkdir(dir, { recursive: true })
  const name = backupName(now)
  // A consistent copy, even while the app writes: SQLite takes care of it.
  if (!listBackups(dir).some(copy => copy.name === name)) {
    db.prepare('VACUUM INTO ?').run(path.join(dir, name))
    await backupPlugins(path.join(dir, name), plugins)
  }
  pruneBackups(dir, kept)
}

// « Sauvegarder maintenant »: a copy made at once, beside the nightly ones; the oldest goes if there are too many.
export const backupNow = async (
  db: Database,
  dir: string,
  now: number,
  kept = BACKUPS_KEPT,
  plugins?: PluginBackup
) => {
  await mkdir(dir, { recursive: true })
  const name = manualName(now)
  const file = path.join(dir, name)
  rmSync(file, { force: true })
  db.prepare('VACUUM INTO ?').run(file)
  await backupPlugins(file, plugins)
  pruneBackups(dir, kept)
  return name
}

// « Restaurer »: the copy waits beside the database until Hodi starts again, then takes its place before the database
// opens. The database in use is never written over while it is open.
export const PENDING_RESTORE = 'restore-pending.db'

// Every SQLite database starts with these 16 bytes.
const SQLITE_HEADER = 'SQLite format 3\0'

export const isDatabaseFile = (file: string) => {
  try {
    const fd = openSync(file, 'r')
    try {
      const header = Buffer.alloc(16)
      return readSync(fd, header, 0, 16, 0) === 16 && header.toString('latin1') === SQLITE_HEADER
    } finally {
      closeSync(fd)
    }
  } catch {
    return false
  }
}

// When a copy was made, from its name, at the earliest: a nightly copy's day starts at midnight UTC, a copy made by
// hand has its second. Never from the file's time, which moves if the file is copied again. null for another name.
export const copyTimeOf = (name: string): number | null => {
  const match = /^hodi-(\d{4})-(\d{2})-(\d{2})(?:-(\d{2})(\d{2})(\d{2}))?\.db$/.exec(name)
  if (!match) return null
  const [year, month, day, hours = '0', minutes = '0', seconds = '0'] = match.slice(1)
  const at = Date.UTC(+year!, +month! - 1, +day!, +hours, +minutes, +seconds)
  return Number.isFinite(at) ? at : null
}

// The earliest moment a restore could take the server back to: the oldest copy kept, or the one waiting to be put
// back (the copy of now made before a restore may already have pushed it out of the list). null when there is none.
export const oldestRestorable = (dir: string, pending: string): number | null => {
  const times = [
    ...listBackups(dir).map(copy => copyTimeOf(copy.name) ?? 0),
    ...(existsSync(pending) ? [readRestoreTime(pending) ?? 0] : [])
  ]
  return times.length === 0 ? null : Math.min(...times)
}

// When the copy set aside was made, beside it.
export const restoreTimeFile = (pending: string) => `${pending}.json`

export const readRestoreTime = (pending: string): number | null => {
  try {
    const at: unknown = (JSON.parse(readFileSync(restoreTimeFile(pending), 'utf8')) as { at?: unknown }).at
    return typeof at === 'number' && Number.isFinite(at) ? at : null
  } catch {
    return null
  }
}

// The copy chosen, set aside for the next start.
export const stageRestore = (copy: string, pending: string) => {
  copyFileSync(copy, `${pending}.part`)
  renameSync(`${pending}.part`, pending)
}

// At the start, before the database opens: a copy set aside takes the database's place. Its journal goes with the
// database it belonged to. True when a copy was put back.
export const applyPendingRestore = (databaseFile: string, pending: string) => {
  if (!existsSync(pending)) return false
  if (!isDatabaseFile(pending)) {
    rmSync(pending, { force: true })
    return false
  }
  rmSync(`${databaseFile}-wal`, { force: true })
  rmSync(`${databaseFile}-shm`, { force: true })
  renameSync(pending, databaseFile)
  return true
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
    backupBytes: backups.reduce(
      (total, name) => total + sizeOf(path.join(backupDir, name)) + pluginCopyBytes(path.join(backupDir, name)),
      0
    ),
    backups: backups.length
  }
}

// Every hour: drop what is past its retention, and make the day's backup once.
export const startMaintenance = (
  {
    db,
    stores,
    backupDir,
    kept = () => BACKUPS_KEPT,
    plugins
  }: {
    db: Database
    stores: { prune: (now: number) => void }[]
    backupDir: string
    kept?: () => number
    plugins?: PluginBackup
  },
  { now = Date.now, log = console.warn }: { now?: () => number; log?: (message: string) => void } = {}
) => {
  const run = async () => {
    try {
      stores.forEach(store => store.prune(now()))
      await backupDatabase(db, backupDir, now(), kept(), plugins)
    } catch (error) {
      log(`Database maintenance failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  void run()
  const timer = setInterval(() => void run(), CHECK_INTERVAL_MS)
  timer.unref()
  return () => clearInterval(timer)
}
