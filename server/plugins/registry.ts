import { existsSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import type { PluginStore } from '../db/plugin-store.ts'
import { isPublicAddressUrl } from '../news/address-guard.ts'
import { createFetchHttp, createFetchText } from '../news/fetch-text.ts'
import { NO_ACCOUNTS } from './accounts.ts'
import { NO_ARTICLES, type PluginArticle } from './articles.ts'
import { NO_HOUSEHOLDS } from './households.ts'
import { NO_MAIL } from './mail.ts'
import { NO_NOTICES } from './notify.ts'
import { NO_PLUGIN_AI, type PluginAiStatus } from './ai.ts'
import { type Capability, type Manifest, type SettingValues, settingValues } from './manifest.ts'
import type { ManifestTranslations } from './manifest-texts.ts'
import { TRUSTED_KEYS } from './package.ts'
import type { PluginSandbox } from './sandbox/sandbox.ts'
import type { SandboxShape } from './sandbox/protocol.ts'
import { SNAPSHOT_SUFFIX, databasePath } from './sandbox/sqlite-wasm.ts'
import { callContext } from './call-context.ts'
import { pluginErasures } from './erasures.ts'
import { type LoadDeps, type RequestDeps, loadPlugin, pruneKeptData } from './load-plugin.ts'
import { aiActionRunner, articleTeller, dataExporter, dueTasks, signInChecker } from './plugin-calls.ts'
import type { WebParts } from './web-parts.ts'

export { MAX_EXPORT_BYTES } from './plugin-calls.ts'

// Plugins live in the data folder, one folder each, named after the plugin's id:
//   data/plugins/<id>/plugin.json   what the plugin is (manifest.ts)
//   data/plugins/<id>/server.js     its server part, an ES module run in its sandbox (optional)
// What a plugin keeps goes in data/plugin-data/<id>/ (its database, plugin.db), apart, so an update that replaces its
// folder keeps it. Hodi reads them once at start; installing, updating or removing one restarts Hodi.

export interface LoadedPlugin {
  // null when plugin.json could not be read: the plugin is listed by its folder name only, with its error.
  manifest: Manifest | null
  id: string
  // Its folder.
  dir: string
  // Whether a trusted key signed it ("Vérifié"). An unsigned plugin's web part is never served: it would run in Hodi's
  // page, with the session, until plugins' pages run apart.
  signed: boolean
  // Installed by « npx hodi-plugin dev » while Serveur › Plugins › Mode développeur is on: its web part is served
  // although it is unsigned, and its data stays its own from one build to the next.
  dev: boolean
  web: WebParts
  // Its name and description in the languages its locales give them.
  translations: ManifestTranslations
  // Its server part, run apart, and what it exports; null without server.js.
  sandbox: PluginSandbox | null
  shape: SandboxShape | null
  // Why it could not be loaded; such a plugin is shown to the admin and nothing of it runs.
  error: string | null
}

export interface PluginRegistry {
  list: () => LoadedPlugin[]
  get: (id: string) => LoadedPlugin | undefined
  enabled: (id: string) => boolean
  settings: (id: string) => SettingValues
  // Whether an active plugin brings this capability: the rest of Hodi asks this, never a plugin's name.
  provides: (capability: Capability) => boolean
  // An article read for the first time, passed on to the active plugins that listen.
  tellArticle: (article: PluginArticle) => void
  // Starts the scheduled tasks that are due, one at a time per plugin; Hodi asks every minute. Resolves once they ran.
  runDueTasks: () => Promise<void>
  // What one of an active plugin's feeds lists now, as its handler answered it (feeds.ts checks it). Refuses with
  // 'plugin_unavailable' when the plugin is off, gone or has no such feed.
  readFeed: (id: string, key: string) => Promise<unknown>
  // A click on an active, signed plugin's AiButton: runs its aiActions[action] with a ticket for one ctx.ai question.
  // Refuses with 'plugin_unavailable' when the plugin cannot take it; otherwise what the action answered, or why it
  // failed, with what became of its question (null when it asked none).
  runAiAction: (
    id: string,
    action: string,
    input: unknown,
    who: { householdId: number; profileId: number }
  ) => Promise<AiActionResult>
  // The plugin's log lines written after the first `after` ones since Hodi started (the last 200 at most), and the
  // number to ask after next time.
  recentLog: (id: string, after: number) => { lines: string[]; next: number }
  // Asks every active plugin with permissions.signIn and a checkSignIn whether this sign-in may go on: null when all
  // let it, otherwise the first refusal in the plugins' order. A plugin that fails or runs out of time refuses too.
  checkSignIn: (who: { accountId: number; householdId: number | null }) => Promise<SignInRefusal | null>
  // A profile, an account or a household deleted: every plugin with the matching hook (onProfileDeleted,
  // onAccountDeleted, onHouseholdRemoved) is told, now and again until it answered, so that it deletes what it kept.
  profileDeleted: (profileId: number, householdId: number) => void
  accountDeleted: (accountId: number) => void
  householdRemoved: (householdId: number) => void
  // Asks the plugins still waiting to forget someone, again. Hodi asks every minute and once started.
  runErasures: () => Promise<void>
  // « Télécharger une copie »: what each plugin with exportData keeps of this person, by plugin id. A plugin that
  // fails, or answers more than MAX_EXPORT_BYTES, is listed with an error in place of its data.
  exportData: (who: {
    accountId: number
    profileId: number | null
    householdId: number
  }) => Promise<Record<string, unknown>>
  // A plugin's log line, as Hodi writes it.
  log: (id: string, line: string) => void
  store: PluginStore
  // Deletes everything a removed plugin kept: its own database folder, and its row and API 1 tables in Hodi's.
  forget: (id: string) => Promise<void>
  // A backup's copy of a running plugin's database, made in its thread between calls: the file written, or null when
  // Hodi does not run this plugin (its database is then copied as it is). Throws when the copy fails.
  snapshot: (id: string) => Promise<string | null>
  // Ends every plugin's thread (tests, and Hodi stopping).
  stop: () => Promise<void>
}

// A plugin refusing a sign-in, with a key of its own locales (null when it gave none Hodi can show: Hodi's neutral
// message then).
export interface SignInRefusal {
  plugin: string
  message: string | null
}

export type AiActionResult =
  { ok: true; answer: unknown; asked: boolean } | { ok: false; error: unknown; outcome: PluginAiStatus | null }

// The log lines kept for each plugin.
const KEPT_LOG_LINES = 200
// How often Hodi looks for a task that is due.
const TASK_TICK_MS = 60_000

export interface LoadPluginsOptions extends Partial<RequestDeps> {
  dir: string
  dataDir: string
  store: PluginStore
  timeoutMs?: number
  // The keys whose signature makes a plugin "Vérifié" (tests use their own).
  trustedKeys?: readonly string[]
  now?: () => number
  // Whether Hodi runs the plugins' scheduled tasks by itself, every minute (start.ts); tests call runDueTasks.
  scheduleTasks?: boolean
  log?: (message: string) => void
}

// What a plugin's sandbox may be handed; none of it in tests that do not need it.
const requestDepsOf = (options: LoadPluginsOptions): RequestDeps => ({
  // Hodi's outgoing requests, for a plugin's ctx.fetchText and ctx.http, checking each address with isAllowed.
  fetchTextFor: options.fetchTextFor ?? (isAllowed => createFetchText({ isAllowed })),
  fetchHttpFor: options.fetchHttpFor ?? (isAllowed => createFetchHttp({ isAllowed })),
  isPublicUrl: options.isPublicUrl ?? isPublicAddressUrl,
  articles: options.articles ?? NO_ARTICLES,
  accounts: options.accounts ?? NO_ACCOUNTS,
  mail: options.mail ?? NO_MAIL,
  notifier: options.notifier ?? NO_NOTICES,
  ai: options.ai ?? NO_PLUGIN_AI,
  households: options.households ?? NO_HOUSEHOLDS,
  serverSettings:
    options.serverSettings ??
    (() => {
      throw new Error('server_settings_unavailable')
    })
})

// Each plugin's last log lines, numbered, for « npx hodi-plugin dev » to print.
const logLines = () => {
  const lines = new Map<string, { count: number; kept: string[] }>()
  return {
    keep: (id: string, line: string) => {
      const log = lines.get(id) ?? { count: 0, kept: [] }
      log.count++
      log.kept.push(line)
      if (log.kept.length > KEPT_LOG_LINES) log.kept.shift()
      lines.set(id, log)
    },
    after: (id: string, after: number) => {
      const log = lines.get(id) ?? { count: 0, kept: [] }
      const first = log.count - log.kept.length
      return { lines: log.kept.slice(Math.max(0, after - first)), next: log.count }
    }
  }
}

const pluginFolders = (dir: string) =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
        .map(entry => entry.name)
        .sort()
    : []

// Deletes everything a removed plugin kept: its own database folder, and its row and API 1 tables in Hodi's.
const forgetter =
  (loaded: LoadedPlugin[], { dataDir, store, log }: LoadDeps) =>
  async (id: string) => {
    if (!/^[a-z][a-z0-9-]{1,31}$/.test(id)) return
    const plugin = loaded.find(candidate => candidate.id === id)
    // Its thread lets go of its database first.
    await plugin?.sandbox?.stop()
    if (plugin) {
      plugin.sandbox = null
      plugin.shape = null
    }
    rmSync(path.join(dataDir, id), { recursive: true, force: true })
    store.forget(id)
    log(`[plugin ${id}] its data was deleted`)
  }

// A backup's copy of a running plugin's database, made in its thread between calls.
const snapshotter = (loaded: LoadedPlugin[], dataDir: string) => async (id: string) => {
  const sandbox = loaded.find(candidate => candidate.id === id)?.sandbox
  if (!sandbox) return null
  const file = `${databasePath(path.join(dataDir, id, 'plugin.db'))}${SNAPSHOT_SUFFIX}`
  // SQLite never writes over a file: one left by a copy that stopped half-way goes first.
  rmSync(file, { force: true })
  await sandbox.snapshot()
  return file
}

export const loadPlugins = async (options: LoadPluginsOptions): Promise<PluginRegistry> => {
  const { dataDir, store, scheduleTasks = false } = options
  const lines = logLines()
  const deps: LoadDeps = {
    dir: options.dir,
    dataDir,
    store,
    requests: requestDepsOf(options),
    timeoutMs: options.timeoutMs,
    trustedKeys: options.trustedKeys ?? TRUSTED_KEYS,
    now: options.now ?? Date.now,
    log: options.log ?? console.log,
    keepLine: lines.keep
  }
  const { now, log } = deps
  const folders = pluginFolders(options.dir)
  pruneKeptData(folders, deps)
  const loaded: LoadedPlugin[] = []
  for (const folder of folders) loaded.push(await loadPlugin(folder, deps))

  const get = (id: string) => loaded.find(plugin => plugin.id === id)
  const enabled = (id: string) => {
    const plugin = get(id)
    return Boolean(plugin?.manifest && !plugin.error && store.state(id, now()).enabled)
  }
  const calls = { loaded, store, enabled, now, log }
  const runDueTasks = dueTasks(calls)
  const { runErasures, erase } = pluginErasures({ loaded, store, dataDir, now, log })

  const ticker = scheduleTasks
    ? setInterval(() => {
        void runDueTasks()
        void runErasures()
      }, TASK_TICK_MS)
    : null
  // Deletions a restart interrupted.
  if (scheduleTasks) void runErasures()
  ticker?.unref()

  return {
    list: () => loaded,
    get,
    enabled,
    settings: id => {
      const manifest = get(id)?.manifest
      return manifest ? settingValues(manifest.settings, store.state(id, now()).settings) : {}
    },
    provides: capability => loaded.some(plugin => plugin.manifest?.provides.includes(capability) && enabled(plugin.id)),
    tellArticle: articleTeller(calls),
    runDueTasks,
    recentLog: lines.after,
    readFeed: async (id, key) => {
      const plugin = get(id)
      const declared = plugin?.manifest?.feeds.some(feed => feed.key === key)
      if (!plugin?.sandbox || !declared || !plugin.shape?.feeds.includes(key) || !enabled(id)) {
        throw new Error('plugin_unavailable')
      }
      // For no household: one read serves every household that follows the feed.
      return plugin.sandbox.call('feed', key, null, callContext(null))
    },
    runAiAction: aiActionRunner(calls),
    checkSignIn: signInChecker(calls),
    profileDeleted: (profileId, householdId) => erase('onProfileDeleted', { profileId, householdId }, householdId),
    accountDeleted: accountId => erase('onAccountDeleted', { accountId }, null),
    householdRemoved: householdId => erase('onHouseholdRemoved', { householdId }, householdId),
    runErasures,
    exportData: dataExporter(calls),
    log: (id, line) => log(`[plugin ${id}] ${line}`),
    store,
    forget: forgetter(loaded, deps),
    snapshot: snapshotter(loaded, dataDir),
    stop: async () => {
      if (ticker) clearInterval(ticker)
      await Promise.all(loaded.map(plugin => plugin.sandbox?.stop()))
    }
  }
}
