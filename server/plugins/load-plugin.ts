import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import type { PluginStore } from '../db/plugin-store.ts'
import { type Manifest, OUTDATED_API, PLUGIN_API, parseManifest, settingValues, signedOnlyAsked } from './manifest.ts'
import { ownerOf, signerOf } from './package.ts'
import { checkShape } from './plugin-shape.ts'
import { PluginSandbox } from './sandbox/sandbox.ts'
import { message, requestsOf } from './sandbox-requests.ts'
import { manifestTranslations } from './manifest-texts.ts'
import { textsOnly, webParts } from './web-parts.ts'
import type { LoadedPlugin } from './registry.ts'

// How long a plugin's data stays without the plugin (removed with its data kept, or set aside for another maker).
export const KEPT_DATA_MS = 30 * 24 * 60 * 60 * 1000

// What every plugin's sandbox may be handed, as its manifest allows (sandbox-requests.ts).
export type RequestDeps = Omit<Parameters<typeof requestsOf>[1], 'signed'>

export interface LoadDeps {
  dir: string
  dataDir: string
  store: PluginStore
  requests: RequestDeps
  timeoutMs: number | undefined
  trustedKeys: readonly string[]
  now: () => number
  log: (message: string) => void
  // A log line of the plugin's own, kept for « npx hodi-plugin dev ».
  keepLine: (id: string, line: string) => void
}

// Data kept without its plugin goes after KEPT_DATA_MS: what a removal kept for a reinstall, and what another maker's
// plugin set aside. Until then, deletions wait for it (erasures.ts).
export const pruneKeptData = (folders: string[], { dataDir, store, now, log }: LoadDeps) => {
  if (existsSync(dataDir)) {
    for (const name of readdirSync(dataDir)) {
      const at = /\.orphan-(\d+)$/.exec(name)?.[1]
      if (at && now() - Number(at) > KEPT_DATA_MS) {
        rmSync(path.join(dataDir, name), { recursive: true, force: true })
        log(`Plugin data ${name} deleted: set aside more than 30 days ago`)
      }
    }
  }
  store.markGone(folders, now())
  for (const id of store.removedBefore(now() - KEPT_DATA_MS)) {
    if (folders.includes(id)) continue
    rmSync(path.join(dataDir, id), { recursive: true, force: true })
    store.forget(id)
    log(`[plugin ${id}] its data was deleted: removed more than 30 days ago`)
  }
}

// plugin.json, checked. A plugin written for API 1 is still listed by its name, to be updated; nothing of it runs.
const readManifest = (plugin: LoadedPlugin): Manifest => {
  const raw: unknown = JSON.parse(readFileSync(path.join(plugin.dir, 'plugin.json'), 'utf8'))
  try {
    parseManifest(raw)
  } catch (error) {
    if (!(error instanceof Error && error.message === OUTDATED_API)) throw error
    plugin.manifest = parseManifest({ ...(raw as object), api: PLUGIN_API })
    throw error
  }
  const manifest = parseManifest(raw)
  if (manifest.id !== plugin.id) throw new Error(`its folder must be named ${manifest.id}`)
  // Set before the refusal below, so that a refused plugin is still listed by its name.
  plugin.manifest = manifest
  // Installed before signed-only permissions existed, or copied in by hand: an unsigned plugin asking for one does
  // not run. A build of « npx hodi-plugin dev » keeps them, to test them.
  const refused = plugin.signed || plugin.dev ? [] : signedOnlyAsked(manifest)
  if (refused.length > 0)
    throw new Error(`only a verified plugin may ask for permissions.${refused.join(', permissions.')}`)
  return manifest
}

// The data under this id belongs to whoever made the plugin. Another maker taking the same id (a plugin removed, then
// an unsigned one named like it) starts empty: the old folder is set aside, the settings are cleared. Data from before
// owners were recorded is kept only by a signed plugin. Answers whether the data was someone else's.
const claimData = (plugin: LoadedPlugin, manifest: Manifest, { dataDir, store, trustedKeys, now, log }: LoadDeps) => {
  const own = path.join(dataDir, manifest.id)
  // A build of « npx hodi-plugin dev » keeps the data of the one before: each build's files differ.
  const owner = plugin.dev ? `dev:${manifest.id}` : ownerOf(plugin.dir, trustedKeys)
  const before = store.dataOwner(manifest.id)
  const stranger = before !== null ? before !== owner : !plugin.signed && existsSync(own)
  if (stranger) {
    if (existsSync(own)) renameSync(own, path.join(dataDir, `${manifest.id}.orphan-${now()}`))
    store.clearSettings(manifest.id)
    log(`[plugin ${manifest.id}] made by someone else than its data: it starts with none, the old data is set aside`)
  }
  if (before !== owner) store.setDataOwner(manifest.id, owner)
  return stranger
}

// Its server part, run apart: its migrations run in its own database, and it says what it exports.
const startSandbox = async (plugin: LoadedPlugin, manifest: Manifest, stranger: boolean, deps: LoadDeps) => {
  const { dataDir, store, timeoutMs, now, log, keepLine } = deps
  const own = path.join(dataDir, manifest.id)
  mkdirSync(own, { recursive: true })
  const dbFile = path.join(own, 'plugin.db')
  // A signed plugin that kept its tables in Hodi's database (API 1) finds a copy of them in its own, once. Only the
  // maintainer's plugins were API 1, all signed: an unsigned one, or another key than the data's, never gets a copy.
  if (plugin.signed && !stranger) {
    const { copied, skipped } = store.copyLegacyTables(manifest.id, dbFile)
    if (copied > 0) log(`[plugin ${manifest.id}] ${copied} tables copied from Hodi's database into its own`)
    if (skipped.length > 0) log(`[plugin ${manifest.id}] virtual tables not copied: ${skipped.join(', ')}`)
  }
  plugin.sandbox = new PluginSandbox({
    id: manifest.id,
    source: readFileSync(path.join(plugin.dir, 'server.js'), 'utf8'),
    dbFile,
    ...(manifest.memoryMb ? { memoryMb: manifest.memoryMb } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
    host: {
      requests: requestsOf(manifest, { ...deps.requests, signed: plugin.signed }),
      log: line => {
        log(`[plugin ${manifest.id}] ${line}`)
        keepLine(manifest.id, line)
      },
      settings: () => settingValues(manifest.settings, store.state(manifest.id, now()).settings)
    }
  })
  plugin.shape = await plugin.sandbox.start()
  checkShape(plugin.shape)
  for (const feed of manifest.feeds) {
    if (!plugin.shape.feeds.includes(feed.key)) log(`[plugin ${manifest.id}] feed ${feed.key} has no handler in feeds`)
  }
  // Routes open to anyone are served only when the manifest asks for them, as the admin saw at the install.
  if (plugin.shape.publicRoutes.length > 0 && !manifest.permissions.publicRoutes)
    log(`[plugin ${manifest.id}] publicRoutes not served: plugin.json does not ask for permissions.publicRoutes`)
}

// One folder of data/plugins. A broken plugin never stops Hodi: it is listed with its error, and nothing of it runs.
export const loadPlugin = async (folder: string, deps: LoadDeps): Promise<LoadedPlugin> => {
  const { dir, store, trustedKeys, now, log } = deps
  const root = path.join(dir, folder)
  const signed = signerOf(root, trustedKeys) !== null
  const dev = !signed && store.isDev(folder)
  const plugin: LoadedPlugin = {
    manifest: null,
    id: folder,
    dir: root,
    signed,
    dev,
    web: signed || dev ? webParts(root) : textsOnly(root),
    translations: manifestTranslations(root),
    sandbox: null,
    shape: null,
    error: null
  }
  try {
    const manifest = readManifest(plugin)
    store.state(manifest.id, now())
    // Installed again: what was kept is its own once more.
    store.setRemoved(manifest.id, null)
    const stranger = claimData(plugin, manifest, deps)
    if (existsSync(path.join(root, 'server.js'))) await startSandbox(plugin, manifest, stranger, deps)
  } catch (error) {
    plugin.error = message(error)
    await plugin.sandbox?.stop()
    plugin.sandbox = null
    plugin.shape = null
    log(`Plugin ${folder} not loaded: ${plugin.error}`)
  }
  return plugin
}
