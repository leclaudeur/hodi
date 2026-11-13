import { rmSync } from 'node:fs'
import path from 'node:path'
import type { Config } from '../config.ts'
import { openDatabase } from '../db/database.ts'
import {
  PENDING_RESTORE,
  applyPendingRestore,
  oldestRestorable,
  readRestoreTime,
  restoreTimeFile
} from '../db/maintenance.ts'
import { applyPluginRestore, pluginCopyDir } from '../db/plugin-backup.ts'
import { ForgetLog, type ForgetRecord, replayForgotten, setForgetLog } from '../db/forget-log.ts'

// The database as Hodi starts on it: a copy « Restaurer » set aside before the restart takes its place first, and the
// deletions made since that copy are done again.
export const openRestoredDatabase = (config: Config) => {
  const pendingRestore = path.join(path.dirname(config.databaseFile), PENDING_RESTORE)
  const pluginDataDir = path.join(path.dirname(config.databaseFile), 'plugin-data')
  // What was deleted of people, outside the database: a restored copy has it deleted again.
  const forgetLog = new ForgetLog(path.join(path.dirname(config.databaseFile), 'forgotten.jsonl'), {
    oldestCopy: () => oldestRestorable(config.backupDir, pendingRestore)
  })
  setForgetLog(forgetLog)
  let forgottenAgain: ForgetRecord[] = []
  const restored = applyPendingRestore(config.databaseFile, pendingRestore)
  if (restored) {
    console.log('Restored the database from a backup')
    // The plugins' data goes back to the same moment, before any plugin loads.
    applyPluginRestore(pendingRestore, pluginDataDir, Date.now(), line => console.log(line))
    // A copy whose time is unknown has every deletion still written down done again.
    forgottenAgain = forgetLog.since(readRestoreTime(pendingRestore) ?? 0)
  }
  rmSync(pluginCopyDir(pendingRestore), { recursive: true, force: true })
  rmSync(restoreTimeFile(pendingRestore), { force: true })
  const db = openDatabase(config.databaseFile)
  if (forgottenAgain.length > 0) {
    replayForgotten(db, forgottenAgain, Date.now())
    console.log(`${forgottenAgain.length} deletions made since that copy were done again`)
  }
  return { db, forgetLog, forgottenAgain, pendingRestore, pluginDataDir }
}
