import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, describe, it } from 'node:test'
import { openDatabase } from '../db/database.ts'
import { applyPendingRestore, backupNow, listBackups, pruneBackups, stageRestore } from '../db/maintenance.ts'
import { applyPluginRestore, pluginCopyDir, readPluginManifest, stagePluginRestore } from '../db/plugin-backup.ts'
import { PluginStore } from '../db/plugin-store.ts'
import { PLUGIN_API } from '../plugins/manifest.ts'
import { type PluginRegistry, loadPlugins } from '../plugins/registry.ts'

// A plugin that keeps notes in its own database.
const NOTES = `export default {
  migrations: ['CREATE TABLE notes (text TEXT)'],
  routes: {
    'POST /note': async (request, ctx) => { ctx.db.run('INSERT INTO notes (text) VALUES (?)', [request.body.text]); return { body: null } },
    'GET /notes': async (_request, ctx) => ({ body: ctx.db.query('SELECT text FROM notes ORDER BY rowid').map(row => row.text) })
  }
}`

const registries: PluginRegistry[] = []
after(async () => {
  await Promise.all(registries.map(registry => registry.stop()))
})

const DAY = 24 * 60 * 60 * 1000
let clock = 1_000_000

// A server's data folder: Hodi's database in a file (a restore replaces it), its plugins, their data and the copies.
const server = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'hodi-plugin-backup-'))
  return {
    databaseFile: path.join(root, 'hodi.db'),
    dir: path.join(root, 'plugins'),
    dataDir: path.join(root, 'plugin-data'),
    backupDir: path.join(root, 'backups'),
    pending: path.join(root, 'restore-pending.db')
  }
}
type Server = ReturnType<typeof server>

const install = (at: Server, id: string) => {
  mkdirSync(path.join(at.dir, id), { recursive: true })
  writeFileSync(
    path.join(at.dir, id, 'plugin.json'),
    JSON.stringify({ id, name: id, version: '0.1.0', description: 'Notes.', api: PLUGIN_API, audience: 'admin' })
  )
  writeFileSync(path.join(at.dir, id, 'server.js'), NOTES)
}

const start = async (at: Server) => {
  mkdirSync(at.dir, { recursive: true })
  const db = openDatabase(at.databaseFile)
  const store = new PluginStore(db)
  const logs: string[] = []
  const registry = await loadPlugins({
    dir: at.dir,
    dataDir: at.dataDir,
    store,
    now: () => clock,
    log: line => logs.push(line)
  })
  registries.push(registry)
  const note = (id: string, text: string) => registry.get(id)!.sandbox!.call('routes', 'POST /note', { body: { text } })
  const notes = async (id: string) =>
    ((await registry.get(id)!.sandbox!.call('routes', 'GET /notes', {})) as { body: string[] }).body
  const stop = async () => {
    await registry.stop()
    db.close()
  }
  return { db, store, registry, logs, note, notes, stop }
}

const notesOnDisk = (file: string) => {
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    return (db.prepare('SELECT text FROM notes ORDER BY rowid').all() as { text: string }[]).map(row => row.text)
  } finally {
    db.close()
  }
}

// « Restaurer » as Hodi does it: set aside now, put back at the next start.
const restore = (at: Server, name: string) => {
  const copy = path.join(at.backupDir, name)
  stageRestore(copy, at.pending)
  stagePluginRestore(copy, at.pending)
}
const restart = (at: Server, logs: string[] = []) => {
  assert.ok(applyPendingRestore(at.databaseFile, at.pending))
  applyPluginRestore(at.pending, at.dataDir, clock, line => logs.push(line))
  rmSync(pluginCopyDir(at.pending), { recursive: true, force: true })
  return logs
}

describe('backups with the plugins’ data', () => {
  it('copies a running plugin’s database in its thread, whole, beside the core’s copy', async () => {
    const at = server()
    install(at, 'notes')
    const hodi = await start(at)
    await hodi.note('notes', 'avant')
    const name = await backupNow(hodi.db, at.backupDir, clock, 7, {
      dataDir: at.dataDir,
      snapshots: () => hodi.registry
    })
    await hodi.note('notes', 'après')
    // A snapshot left half-way by an earlier copy does not stop the next one.
    writeFileSync(path.join(at.dataDir, 'notes', 'plugin.db.backup'), 'half')
    const next = await backupNow(hodi.db, at.backupDir, clock + 1000, 7, {
      dataDir: at.dataDir,
      snapshots: () => hodi.registry
    })
    assert.deepEqual(notesOnDisk(path.join(pluginCopyDir(path.join(at.backupDir, next)), 'notes.db')), [
      'avant',
      'après'
    ])
    const copies = pluginCopyDir(path.join(at.backupDir, name))
    assert.deepEqual(readPluginManifest(copies), { plugins: ['notes'], missing: [] })
    assert.deepEqual(notesOnDisk(path.join(copies, 'notes.db')), ['avant'])
    // The snapshot left nothing beside the plugin's database.
    assert.deepEqual(
      readdirSync(path.join(at.dataDir, 'notes')).filter(file => file.includes('.backup')),
      []
    )
    assert.ok(listBackups(at.backupDir)[0]!.bytes > 0)
    await hodi.stop()
  })

  it('copies the data of a plugin Hodi does not run as it is, and skips what was set aside', async () => {
    const at = server()
    install(at, 'notes')
    const first = await start(at)
    await first.note('notes', 'gardée')
    await first.stop()
    // Removed, its data kept for a reinstall; and another maker's data set aside.
    rmSync(path.join(at.dir, 'notes'), { recursive: true })
    mkdirSync(path.join(at.dataDir, `old.orphan-${clock}`))
    const hodi = await start(at)
    const name = await backupNow(hodi.db, at.backupDir, clock, 7, {
      dataDir: at.dataDir,
      snapshots: () => hodi.registry
    })
    const copies = pluginCopyDir(path.join(at.backupDir, name))
    assert.deepEqual(readPluginManifest(copies), { plugins: ['notes'], missing: [] })
    assert.deepEqual(notesOnDisk(path.join(copies, 'notes.db')), ['gardée'])
    await hodi.stop()
  })

  it('lists a plugin whose copy failed as missing, and still makes the rest of the copy', async () => {
    const at = server()
    install(at, 'notes')
    install(at, 'other')
    const hodi = await start(at)
    const logs: string[] = []
    const name = await backupNow(hodi.db, at.backupDir, clock, 7, {
      dataDir: at.dataDir,
      snapshots: () => ({
        snapshot: id => (id === 'other' ? Promise.reject(new Error('busy')) : hodi.registry.snapshot(id))
      }),
      log: line => logs.push(line)
    })
    const copies = pluginCopyDir(path.join(at.backupDir, name))
    assert.deepEqual(readPluginManifest(copies), { plugins: ['notes', 'other'], missing: ['other'] })
    assert.deepEqual(readdirSync(copies).sort(), ['copy.json', 'notes.db'])
    assert.deepEqual(logs, ['[plugin other] its data is not in this backup: busy'])
    await hodi.stop()
  })

  it('restores the core and every plugin to the same moment', async () => {
    const at = server()
    install(at, 'notes')
    install(at, 'gone')
    let hodi = await start(at)
    await hodi.note('notes', 'le 5')
    await hodi.note('gone', 'le 5')
    const name = await backupNow(hodi.db, at.backupDir, clock, 7, {
      dataDir: at.dataDir,
      snapshots: () => hodi.registry
    })
    // After the copy: more notes, « gone » removed (its data kept), « late » installed.
    await hodi.note('notes', 'le 8')
    await hodi.stop()
    rmSync(path.join(at.dir, 'gone'), { recursive: true })
    install(at, 'late')
    hodi = await start(at)
    hodi.store.setRemoved('gone', clock)
    await hodi.note('late', 'le 8')
    restore(at, name)
    await hodi.stop()

    clock += DAY
    const logs = restart(at)
    hodi = await start(at)
    // Back to the copy: its notes of then.
    assert.deepEqual(await hodi.notes('notes'), ['le 5'])
    // Installed since: it starts empty, its data of now set aside.
    assert.deepEqual(await hodi.notes('late'), [])
    assert.ok(readdirSync(at.dataDir).some(entry => entry.startsWith('late.orphan-')))
    // Removed since: its code does not come back, its data does, kept 30 days for a reinstall.
    assert.equal(hodi.registry.get('gone'), undefined)
    assert.deepEqual(notesOnDisk(path.join(at.dataDir, 'gone', 'plugin.db')), ['le 5'])
    assert.deepEqual(hodi.store.removedBefore(clock), ['gone'])
    assert.deepEqual(logs, ['[plugin late] it had no data at the time of the copy: its data now is set aside'])
    await hodi.stop()
  })

  it('leaves a plugin’s data as it is when its copy failed, or when the copy holds no plugin data', async () => {
    const at = server()
    install(at, 'notes')
    let hodi = await start(at)
    await hodi.note('notes', 'le 5')
    // A copy from before the plugins' data was backed up: the core's alone.
    const old = await backupNow(hodi.db, at.backupDir, clock, 7)
    const failed = await backupNow(hodi.db, at.backupDir, clock + 1000, 7, {
      dataDir: at.dataDir,
      snapshots: () => ({ snapshot: () => Promise.reject(new Error('busy')) }),
      log: () => {}
    })
    await hodi.note('notes', 'le 8')
    restore(at, old)
    await hodi.stop()
    assert.deepEqual(restart(at), ['This copy holds no plugin data: the plugins keep theirs as it is'])
    hodi = await start(at)
    assert.deepEqual(await hodi.notes('notes'), ['le 5', 'le 8'])
    restore(at, failed)
    await hodi.stop()
    assert.deepEqual(restart(at), ['[plugin notes] its data was not in the copy: it keeps its data as it is'])
    hodi = await start(at)
    assert.deepEqual(await hodi.notes('notes'), ['le 5', 'le 8'])
    await hodi.stop()
  })

  it('logs a plugin whose data cannot be put back, and restores the others', async () => {
    const at = server()
    install(at, 'notes')
    install(at, 'other')
    const hodi = await start(at)
    await hodi.note('notes', 'le 5')
    await hodi.note('other', 'le 5')
    const name = await backupNow(hodi.db, at.backupDir, clock, 7, {
      dataDir: at.dataDir,
      snapshots: () => hodi.registry
    })
    await hodi.note('other', 'le 8')
    restore(at, name)
    await hodi.stop()
    // Something on disk stands where « notes » keeps its data: it cannot be put back.
    rmSync(path.join(at.dataDir, 'notes'), { recursive: true })
    writeFileSync(path.join(at.dataDir, 'notes'), 'not a folder')
    const logs = restart(at)
    assert.equal(logs.length, 1)
    assert.match(logs[0]!, /^\[plugin notes\] its data could not be restored, it keeps it as it is: /)
    assert.equal(readFileSync(path.join(at.dataDir, 'notes'), 'utf8'), 'not a folder')
    assert.deepEqual(notesOnDisk(path.join(at.dataDir, 'other', 'plugin.db')), ['le 5'])
  })

  it('removes a copy’s plugins with it', async () => {
    const at = server()
    install(at, 'notes')
    const hodi = await start(at)
    const plugins = { dataDir: at.dataDir, snapshots: () => hodi.registry }
    const first = await backupNow(hodi.db, at.backupDir, clock, 7, plugins)
    const second = await backupNow(hodi.db, at.backupDir, clock + 1000, 7, plugins)
    // A plugins' folder left without its core copy goes too.
    mkdirSync(path.join(at.backupDir, 'hodi-1999-01-01.plugins'))
    pruneBackups(at.backupDir, 1)
    const left = listBackups(at.backupDir).map(copy => copy.name)
    assert.equal(left.length, 1)
    assert.deepEqual(readdirSync(at.backupDir).sort(), [left[0]!, left[0]!.replace(/\.db$/, '.plugins')].sort())
    assert.ok([first, second].includes(left[0]!))
    assert.deepEqual(
      JSON.parse(readFileSync(path.join(pluginCopyDir(path.join(at.backupDir, left[0]!)), 'copy.json'), 'utf8')),
      {
        plugins: ['notes'],
        missing: []
      }
    )
    await hodi.stop()
  })
})
