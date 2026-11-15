import { createReadStream, existsSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type express from 'express'
import { Zip, ZipPassThrough } from 'fflate'
import { verifyPassword } from '../auth/password.ts'
import type { Database } from '../db/database.ts'
import {
  BACKUP_FILE,
  type PluginBackup,
  copyTimeOf,
  backupNow,
  isDatabaseFile,
  listBackups,
  pruneBackups,
  restoreTimeFile,
  stageRestore
} from '../db/maintenance.ts'
import { pluginCopyDir, readPluginManifest, stagePluginRestore } from '../db/plugin-backup.ts'
import { BACKUP_COPIES, type ServerSettingsStore, isValidCopies } from '../db/server-settings-store.ts'
import type { UserAccountStore } from '../db/user-account-store.ts'
import { type CheckProof, accountAsking } from './proof.ts'

// Serveur › Sauvegardes: the copies of the whole database, their download and « Restaurer ».

export interface Backups {
  db: Database
  dir: string
  plugins?: PluginBackup
  restore?: { pending: string; restart: () => void }
}

interface BackupOptions {
  settings: ServerSettingsStore
  backups: Backups
  accounts: UserAccountStore
  checkProof?: CheckProof
  now: () => number
}

// Files sent as one zip as they are read, stored without compression (databases): what was written leaves before more
// is read. A failure once bytes have left ends the download, which the browser shows as failed.
const sendFilesAsZip = async (response: express.Response, files: { path: string; file: string }[]) => {
  let failed = false
  const archive = new Zip((error, chunk, final) => {
    if (error || failed) {
      failed = true
      response.destroy()
      return
    }
    response.write(chunk)
    if (final) response.end()
  })
  try {
    for (const { path: name, file } of files) {
      const entry = new ZipPassThrough(name)
      archive.add(entry)
      let last: Buffer | null = null
      for await (const chunk of createReadStream(file)) {
        if (last) entry.push(last)
        last = chunk as Buffer
        if (response.writableNeedDrain) await new Promise(resolve => response.once('drain', resolve))
        if (response.destroyed) throw new Error('closed')
      }
      entry.push(last ?? new Uint8Array(0), true)
    }
    archive.end()
  } catch {
    failed = true
    response.destroy()
  }
}

// 403 two_factor_setup while the server admin's « Validation en deux étapes » is off; false when sent.
type TwoFactorReady = (response: express.Response) => boolean

export const mountBackupRoutes = (router: express.Router, options: BackupOptions, twoFactorReady: TwoFactorReady) => {
  const backupProof = backupProofOf(options, twoFactorReady)
  mountBackupListRoutes(router, options)
  mountDownloadRoute(router, options, backupProof)
  mountRestoreRoute(router, options, backupProof)
}

const stateOf =
  ({ settings, backups: { dir } }: BackupOptions) =>
  () => ({
    copies: listBackups(dir),
    kept: settings.backupCopies(),
    bounds: BACKUP_COPIES
  })

const mountBackupListRoutes = (router: express.Router, options: BackupOptions) => {
  const { settings, backups, now } = options
  const { db, dir } = backups
  const state = stateOf(options)

  // Sauvegardes: the copies of the whole database, the newest first, and how many are kept.
  router.get('/backups', (_request, response) => {
    response.json(state())
  })

  router.patch('/backups', (request, response) => {
    const kept: unknown = request.body?.kept
    if (!isValidCopies(kept)) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    settings.setBackupCopies(kept)
    pruneBackups(dir, kept)
    response.json(state())
  })

  // « Sauvegarder maintenant ».
  router.post('/backups', async (_request, response) => {
    await backupNow(db, dir, now(), settings.backupCopies(), backups.plugins)
    response.status(201).json(state())
  })
}

const backupProofOf = ({ accounts, checkProof }: BackupOptions, twoFactorReady: TwoFactorReady) => {
  // Always the password of the account asking, which tests without accounts give too.
  const backupProof = async (request: express.Request, response: express.Response) => {
    const account = accountAsking(response, accounts)
    if (!account) {
      response.status(403).json({ error: 'invalid_password' })
      return false
    }
    if (!twoFactorReady(response)) return false
    if (checkProof) return checkProof(account, request, response)
    const password: unknown = request.body?.password
    if (typeof password === 'string' && (await verifyPassword(password, account.passwordHash))) return true
    response.status(403).json({ error: 'invalid_password' })
    return false
  }
  return backupProof
}

type BackupProof = ReturnType<typeof backupProofOf>

const mountDownloadRoute = (router: express.Router, { backups: { dir } }: BackupOptions, backupProof: BackupProof) => {
  // A copy holds everyone's data: it leaves the server only with the password of the account asking for it.
  router.post('/backups/:name/download', async (request, response) => {
    const { name } = request.params
    if (!BACKUP_FILE.test(name) || !listBackups(dir).some(copy => copy.name === name)) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    if (!(await backupProof(request, response))) return
    response.set('Cache-Control', 'no-store')
    const file = path.join(dir, name)
    const plugins = pluginCopyDir(file)
    const manifest = existsSync(plugins) ? readPluginManifest(plugins) : null
    const pluginFiles = (manifest?.plugins ?? []).flatMap(id =>
      [`${id}.db`, `${id}.db-journal`]
        .map(entry => ({ path: `plugins/${entry}`, file: path.join(plugins, entry) }))
        .filter(entry => existsSync(entry.file))
    )
    // Without any plugin's data, the core's database alone, as before.
    if (pluginFiles.length === 0) {
      response.set('Content-Type', 'application/vnd.sqlite3')
      response.set('Content-Disposition', `attachment; filename="${name}"`)
      createReadStream(file).pipe(response)
      return
    }
    // With the plugins' data: one zip, the core's database and each plugin's, as they are on the server.
    const files = [
      { path: name, file },
      { path: 'plugins/copy.json', file: path.join(plugins, 'copy.json') },
      ...pluginFiles
    ]
    response.set('Content-Type', 'application/zip')
    response.set('Content-Disposition', `attachment; filename="${name.replace(/\.db$/, '.zip')}"`)
    await sendFilesAsZip(response, files)
  })
}

const mountRestoreRoute = (
  router: express.Router,
  { settings, backups, now }: BackupOptions,
  backupProof: BackupProof
) => {
  const { db, dir } = backups
  // « Restaurer »: the whole server goes back to that copy, with the password of the account asking. The state of
  // now is kept first as a copy of its own, then Hodi restarts and the copy takes the database's place.
  const { restore } = backups
  if (restore)
    router.post('/backups/:name/restore', async (request, response) => {
      const { name } = request.params
      if (!BACKUP_FILE.test(name) || !listBackups(dir).some(copy => copy.name === name)) {
        response.status(404).json({ error: 'not_found' })
        return
      }
      if (!(await backupProof(request, response))) return
      const copy = path.join(dir, name)
      if (!isDatabaseFile(copy)) {
        response.status(422).json({ error: 'not_a_backup' })
        return
      }
      // Set aside before the copy of now, which could push the oldest copy out, with the plugins' copies.
      stageRestore(copy, restore.pending)
      stagePluginRestore(copy, restore.pending)
      // When the copy was made: the deletions since are done again once it is back (forget-log.ts).
      // When unsure, the earliest: a deletion done again that the copy already had changes nothing.
      const madeAt = copyTimeOf(name) ?? 0
      writeFileSync(restoreTimeFile(restore.pending), JSON.stringify({ at: madeAt }))
      try {
        await backupNow(db, dir, now(), settings.backupCopies(), backups.plugins)
      } catch {
        rmSync(restore.pending, { force: true })
        rmSync(pluginCopyDir(restore.pending), { recursive: true, force: true })
        rmSync(restoreTimeFile(restore.pending), { force: true })
        response.status(500).json({ error: 'backup_failed' })
        return
      }
      response.on('finish', restore.restart)
      response.status(202).json({ restarting: true })
    })
}
