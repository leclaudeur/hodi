import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import type { PluginStore } from '../db/plugin-store.ts'
import { callContext } from './call-context.ts'
import { message } from './sandbox-requests.ts'
import type { LoadedPlugin } from './registry.ts'

interface ErasureDeps {
  loaded: LoadedPlugin[]
  store: PluginStore
  dataDir: string
  now: () => number
  log: (message: string) => void
}

// A profile, an account or a household deleted: every plugin Hodi keeps something of is asked to forget it, now and
// again until it answered.
export const pluginErasures = ({ loaded, store, dataDir, now, log }: ErasureDeps) => {
  // Whether Hodi still keeps something of this plugin: its row, or its database folder. Data outlives code (removed
  // with its data kept, broken, refused): such a plugin hears of a deletion when it starts again, or loses the data.
  const keepsData = (id: string) => store.ids().includes(id) || existsSync(path.join(dataDir, id))

  const erasePass = async () => {
    const failed = new Map<string, { count: number; error: string }>()
    for (const erasure of store.erasures(now())) {
      const plugin = loaded.find(candidate => candidate.id === erasure.pluginId)
      if (!plugin?.sandbox || !plugin.shape) {
        // Not running: kept until it starts again, or until its data is deleted.
        if (!keepsData(erasure.pluginId)) store.erasureDone(erasure.id)
        continue
      }
      // Running without this hook: it keeps nothing it would delete for it.
      if (!plugin.shape.hooks.includes(erasure.hook)) {
        store.erasureDone(erasure.id)
        continue
      }
      try {
        await plugin.sandbox.call('hook', erasure.hook, erasure.subject, callContext(erasure.householdId))
        store.erasureDone(erasure.id)
      } catch (error) {
        store.erasureFailed(erasure.id, now())
        const seen = failed.get(plugin.id)
        failed.set(plugin.id, { count: (seen?.count ?? 0) + 1, error: message(error) })
      }
    }
    // One line per plugin and pass, not one per deletion.
    for (const [id, { count, error }] of failed)
      log(`[plugin ${id}] ${count} deletions still waiting, asked again later: ${error}`)
  }

  // One pass at a time: a slow plugin never has the same deletion asked twice at once. A deletion recorded during a
  // pass gets another one right after.
  let erasing: Promise<void> | null = null
  let eraseAgain = false
  const runErasures = () => {
    if (erasing) {
      eraseAgain = true
      return erasing
    }
    erasing = (async () => {
      do {
        eraseAgain = false
        await erasePass()
      } while (eraseAgain)
    })().finally(() => {
      erasing = null
    })
    return erasing
  }

  // Every plugin Hodi keeps something of, loaded or not, on or off: the person asked for their data to go, whatever
  // the plugin's state. Whether it has the hook is known once it runs.
  const erase = (hook: string, subject: unknown, householdId: number | null) => {
    const ids = new Set([...loaded.filter(plugin => plugin.manifest).map(plugin => plugin.id), ...store.ids()])
    if (existsSync(dataDir))
      for (const name of readdirSync(dataDir)) if (/^[a-z][a-z0-9-]{1,31}$/.test(name)) ids.add(name)
    for (const id of ids) store.addErasure(id, hook, subject, householdId, now())
    void runErasures()
  }

  return { runErasures, erase }
}
