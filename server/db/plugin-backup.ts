import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

// Serveur › Sauvegardes copies the plugins' own databases too (data/plugin-data/<id>/plugin.db), beside the core's
// copy and of the same moment, so that « Restaurer » puts the core and every plugin back on the same day. Only data:
// a plugin's code is never in a copy, so a plugin removed since stays removed.
//
// hodi-2026-11-08.db           the core's copy
// hodi-2026-11-08.plugins/     the plugins' copies of that moment
//   copy.json                  { plugins: ids Hodi kept data of, missing: ids whose copy failed }
//   village.db                 one database per plugin
//   village.db-journal         a journal left by a plugin that stopped mid-write, put back with it

export const PLUGIN_ID = /^[a-z][a-z0-9-]{1,31}$/
const MANIFEST = 'copy.json'

export interface PluginCopyManifest {
  // Every plugin Hodi kept data of at that moment: on restore, data of any other plugin is set aside.
  plugins: string[]
  // Those whose copy failed: on restore, their data is left as it is.
  missing: string[]
}

// What runs the plugins now (the registry): a consistent copy of a running plugin's database, made in its own thread
// between calls. Answers the file it wrote, or null when Hodi does not run that plugin (its file is then copied as it
// is, since nothing writes it).
export interface PluginSnapshots {
  snapshot: (id: string) => Promise<string | null>
}

// The plugins' folder of a copy: hodi-2026-11-08.db → hodi-2026-11-08.plugins.
export const pluginCopyDir = (copyFile: string) => copyFile.replace(/\.db$/, '.plugins')

export const readPluginManifest = (dir: string): PluginCopyManifest | null => {
  try {
    const value = JSON.parse(readFileSync(path.join(dir, MANIFEST), 'utf8')) as Partial<PluginCopyManifest>
    const ids = (list: unknown) =>
      Array.isArray(list) && list.every(id => typeof id === 'string' && PLUGIN_ID.test(id)) ? (list as string[]) : null
    const plugins = ids(value.plugins)
    const missing = ids(value.missing)
    return plugins && missing ? { plugins, missing } : null
  } catch {
    return null
  }
}

// The plugins that have a data folder: set-aside folders (<id>.orphan-<time>) are not copied, they are on their way
// out.
const pluginIdsWithData = (dataDir: string) => {
  try {
    return readdirSync(dataDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && PLUGIN_ID.test(entry.name))
      .map(entry => entry.name)
  } catch {
    return []
  }
}

// Copies every plugin's database into `into` (made here), with its manifest. A plugin whose copy fails is listed as
// missing and logged: the rest of the copy is still made.
export const backupPluginData = async (
  dataDir: string,
  into: string,
  snapshots: PluginSnapshots | null,
  log: (line: string) => void
): Promise<PluginCopyManifest> => {
  rmSync(into, { recursive: true, force: true })
  await mkdir(into, { recursive: true })
  const plugins = pluginIdsWithData(dataDir)
  const missing: string[] = []
  for (const id of plugins) {
    const target = path.join(into, `${id}.db`)
    try {
      const written = snapshots ? await snapshots.snapshot(id) : null
      if (written) {
        renameOrCopy(written, target)
        continue
      }
      const file = path.join(dataDir, id, 'plugin.db')
      if (!existsSync(file)) continue
      copyFileSync(file, target)
      if (existsSync(`${file}-journal`)) copyFileSync(`${file}-journal`, `${target}-journal`)
    } catch (error) {
      missing.push(id)
      rmSync(target, { force: true })
      log(`[plugin ${id}] its data is not in this backup: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  writeFileSync(path.join(into, MANIFEST), JSON.stringify({ plugins, missing } satisfies PluginCopyManifest))
  return { plugins, missing }
}

const renameOrCopy = (from: string, to: string) => {
  try {
    renameSync(from, to)
  } catch {
    // Another disk: copied, then the snapshot goes.
    copyFileSync(from, to)
    rmSync(from, { force: true })
  }
}

// « Restaurer »: the plugins' copies wait beside the core's until Hodi starts again.
export const stagePluginRestore = (copyFile: string, pending: string) => {
  const from = pluginCopyDir(copyFile)
  const to = pluginCopyDir(pending)
  rmSync(to, { recursive: true, force: true })
  if (existsSync(from)) cpSync(from, to, { recursive: true })
}

// At the start, right after the core's copy took the database's place, before any plugin loads: every plugin's data
// goes back to the same moment.
// - A plugin in the copy gets its database back. Whether its code is still installed does not matter: a plugin removed
//   since finds its data kept, as after any removal, and loses it 30 days later unless it is installed again.
// - A plugin whose data Hodi did not have then (installed since) starts empty: what it has now is set aside, and goes
//   30 days later with the other set-aside folders.
// - A plugin whose copy failed keeps its data as it is.
// A copy made before plugins were backed up has no manifest: the plugins' data is left as it is.
export const applyPluginRestore = (
  pending: string,
  dataDir: string,
  now: number,
  log: (line: string) => void
): boolean => {
  const from = pluginCopyDir(pending)
  if (!existsSync(from)) {
    log('This copy holds no plugin data: the plugins keep theirs as it is')
    return false
  }
  const manifest = readPluginManifest(from)
  if (!manifest) {
    rmSync(from, { recursive: true, force: true })
    log('This copy of the plugins cannot be read: the plugins keep their data as it is')
    return false
  }
  const kept = new Set(manifest.plugins)
  // One plugin that cannot be put back is logged and left as it is: the others, and Hodi's start, go on.
  const step = (id: string, what: () => void) => {
    try {
      what()
    } catch (error) {
      log(
        `[plugin ${id}] its data could not be restored, it keeps it as it is: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
  for (const id of pluginIdsWithData(dataDir)) {
    if (kept.has(id)) continue
    step(id, () => {
      renameSync(path.join(dataDir, id), path.join(dataDir, `${id}.orphan-${now}`))
      log(`[plugin ${id}] it had no data at the time of the copy: its data now is set aside`)
    })
  }
  for (const id of manifest.plugins) {
    if (manifest.missing.includes(id)) {
      log(`[plugin ${id}] its data was not in the copy: it keeps its data as it is`)
      continue
    }
    const copy = path.join(from, `${id}.db`)
    const own = path.join(dataDir, id)
    const file = path.join(own, 'plugin.db')
    if (!isFile(copy)) continue
    step(id, () => {
      mkdirSync(own, { recursive: true })
      for (const suffix of ['', '-journal', '-wal', '-shm']) rmSync(`${file}${suffix}`, { force: true })
      renameOrCopy(copy, file)
      if (isFile(`${copy}-journal`)) renameOrCopy(`${copy}-journal`, `${file}-journal`)
    })
  }
  rmSync(from, { recursive: true, force: true })
  return true
}

const isFile = (file: string) => {
  try {
    return statSync(file).isFile()
  } catch {
    return false
  }
}

// What a copy's plugin databases take on disk.
export const pluginCopyBytes = (copyFile: string) => {
  const dir = pluginCopyDir(copyFile)
  try {
    return readdirSync(dir)
      .filter(name => name !== MANIFEST)
      .reduce((total, name) => total + statSync(path.join(dir, name)).size, 0)
  } catch {
    return 0
  }
}
