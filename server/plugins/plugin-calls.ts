import type { PluginStore } from '../db/plugin-store.ts'
import type { PluginArticle } from './articles.ts'
import { type AiTicket, callContext } from './call-context.ts'
import { SandboxError } from './sandbox/sandbox.ts'
import { message } from './sandbox-requests.ts'
import type { AiActionResult, LoadedPlugin, SignInRefusal } from './registry.ts'

// The most a plugin's part of « Télécharger une copie » may weigh, as JSON.
export const MAX_EXPORT_BYTES = 512 * 1024

// What a refusal may name: a key of the plugin's locales, never text or markup for the page.
const MESSAGE_KEY = /^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z][A-Za-z0-9_-]*){0,4}$/

interface CallDeps {
  loaded: LoadedPlugin[]
  store: PluginStore
  enabled: (id: string) => boolean
  now: () => number
  log: (message: string) => void
}

// Starts the scheduled tasks that are due. Tasks still running never start again before they end, however long.
export const dueTasks = ({ loaded, store, enabled, now, log }: CallDeps) => {
  const running = new Set<string>()
  return async () => {
    const due: Promise<void>[] = []
    for (const plugin of loaded) {
      const { sandbox, shape } = plugin
      if (!sandbox || !shape || !enabled(plugin.id)) continue
      const runs = store.taskRuns(plugin.id)
      for (const [name, every] of Object.entries(shape.tasks)) {
        const key = `${plugin.id} ${name}`
        const at = now()
        if (running.has(key) || at - (runs[name] ?? 0) < every * 60_000) continue
        // Recorded as it starts: a task that fails waits its turn too, rather than failing again each minute.
        store.setTaskRun(plugin.id, name, at)
        running.add(key)
        due.push(
          sandbox
            .call('task', name, null, callContext(null))
            .then(
              () => {},
              (error: unknown) => log(`[plugin ${plugin.id}] task ${name} failed: ${message(error)}`)
            )
            .finally(() => running.delete(key))
        )
      }
    }
    await Promise.all(due)
  }
}

// An article read for the first time, passed on to the active plugins that listen.
export const articleTeller = ({ loaded, enabled, log }: CallDeps) => {
  const dropped = new Map<string, number>()
  return (article: PluginArticle) => {
    for (const plugin of loaded) {
      const { sandbox, shape } = plugin
      if (!sandbox || !shape?.hooks.includes('onArticle') || !enabled(plugin.id)) continue
      // A plugin's mistake never reaches the reader, nor holds it up.
      sandbox.call('hook', 'onArticle', article, callContext()).catch((error: unknown) => {
        if (!(error instanceof SandboxError && error.code === 'busy')) {
          log(`[plugin ${plugin.id}] onArticle failed: ${message(error)}`)
          return
        }
        // A plugin too slow for the articles read is told of fewer: the dropped ones are counted, not each logged.
        const count = (dropped.get(plugin.id) ?? 0) + 1
        dropped.set(plugin.id, count)
        if (Number.isInteger(Math.log10(count))) log(`[plugin ${plugin.id}] onArticle dropped ${count} articles`)
      })
    }
  }
}

// Asks every active plugin with permissions.signIn and a checkSignIn: the first refusal in the plugins' order.
export const signInChecker =
  ({ loaded, enabled, log }: CallDeps) =>
  async (who: { accountId: number; householdId: number | null }) => {
    const asked = loaded.filter(
      plugin => plugin.manifest?.permissions.signIn && plugin.shape?.hooks.includes('checkSignIn') && enabled(plugin.id)
    )
    const answers = await Promise.all(
      asked.map(async (plugin): Promise<SignInRefusal | null> => {
        try {
          const answer = await plugin.sandbox!.call('hook', 'checkSignIn', who, callContext(who.householdId))
          if (answer === null) return null
          // Anything but null refuses: a key of its locales shows its message, anything else Hodi's neutral one.
          return { plugin: plugin.id, message: typeof answer === 'string' && MESSAGE_KEY.test(answer) ? answer : null }
        } catch (error) {
          // Fail closed: a check that cannot answer refuses (the server's admin is never asked).
          log(`[plugin ${plugin.id}] checkSignIn failed: ${message(error)}`)
          return { plugin: plugin.id, message: null }
        }
      })
    )
    return answers.find(answer => answer !== null) ?? null
  }

// « Télécharger une copie »: what each plugin with exportData keeps of this person, by plugin id.
export const dataExporter =
  ({ loaded, log }: CallDeps) =>
  async (who: { accountId: number; profileId: number | null; householdId: number }) => {
    const asked = loaded.filter(plugin => plugin.sandbox && plugin.shape?.hooks.includes('exportData'))
    const copies = await Promise.all(
      asked.map(async plugin => {
        try {
          const data = await plugin.sandbox!.call('hook', 'exportData', who, callContext(who.householdId))
          if (Buffer.byteLength(JSON.stringify(data) ?? 'null') > MAX_EXPORT_BYTES) {
            log(`[plugin ${plugin.id}] exportData answered more than ${MAX_EXPORT_BYTES} bytes`)
            return [plugin.id, { error: 'too_large' }] as const
          }
          return [plugin.id, data ?? null] as const
        } catch (error) {
          log(`[plugin ${plugin.id}] exportData failed: ${message(error)}`)
          return [plugin.id, { error: 'unavailable' }] as const
        }
      })
    )
    return Object.fromEntries(copies)
  }

// A click on an active, signed plugin's AiButton: its aiActions[action] with a ticket for one ctx.ai question.
export const aiActionRunner =
  ({ loaded, enabled, log }: CallDeps) =>
  async (
    id: string,
    action: string,
    input: unknown,
    who: { householdId: number; profileId: number }
  ): Promise<AiActionResult> => {
    const plugin = loaded.find(candidate => candidate.id === id)
    if (
      !plugin?.sandbox ||
      !plugin.signed ||
      !plugin.manifest?.permissions.ai ||
      !plugin.shape?.aiActions.includes(action) ||
      !enabled(id)
    ) {
      throw new Error('plugin_unavailable')
    }
    const ticket: AiTicket = { ...who, used: false, outcome: null }
    try {
      const answer = await plugin.sandbox.call(
        'aiAction',
        action,
        { input, who },
        { ...callContext(who.householdId), ai: ticket }
      )
      return { ok: true, answer, asked: ticket.used }
    } catch (error) {
      log(`[plugin ${id}] aiAction ${action} failed: ${message(error)}`)
      return { ok: false, error, outcome: ticket.outcome }
    }
  }
