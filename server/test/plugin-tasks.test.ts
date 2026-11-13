import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { openDatabase } from '../db/database.ts'
import { PluginStore } from '../db/plugin-store.ts'
import { PLUGIN_API } from '../plugins/manifest.ts'
import { type PluginRegistry, loadPlugins } from '../plugins/registry.ts'

const MINUTE = 60_000

const writePlugin = (dir: string, id: string, server: string) => {
  mkdirSync(path.join(dir, id), { recursive: true })
  writeFileSync(
    path.join(dir, id, 'plugin.json'),
    JSON.stringify({
      id,
      name: id,
      version: '0.1.0',
      description: 'Des tâches.',
      api: PLUGIN_API,
      permissions: { articles: true }
    })
  )
  writeFileSync(path.join(dir, id, 'server.js'), server)
}

// Counts its runs in its own database, and fails on demand.
const COUNTER = `export default {
  migrations: ['CREATE TABLE runs (at INTEGER)', 'CREATE TABLE flags (name TEXT)'],
  routes: {
    'GET /runs': async (_request, ctx) => ({ body: ctx.db.get('SELECT COUNT(*) AS n FROM runs').n }),
    'POST /fail': async (_request, ctx) => { ctx.db.run("INSERT INTO flags (name) VALUES ('fail')"); return { status: 204 } }
  },
  tasks: {
    purge: {
      every: 60,
      run: async ctx => {
        if (ctx.db.get("SELECT name FROM flags WHERE name = 'fail'")) throw new Error('boom')
        ctx.db.run('INSERT INTO runs (at) VALUES (1)')
      }
    }
  }
}`

const registries: PluginRegistry[] = []
after(async () => {
  await Promise.all(registries.map(registry => registry.stop()))
})

describe('scheduled tasks of plugins', () => {
  const setUp = async (plugins: Record<string, string>, clock: { now: number }, store?: PluginStore) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'hodi-tasks-'))
    for (const [id, server] of Object.entries(plugins)) writePlugin(dir, id, server)
    const lines: string[] = []
    const registry = await loadPlugins({
      dir,
      dataDir: mkdtempSync(path.join(tmpdir(), 'hodi-tasks-data-')),
      store: store ?? new PluginStore(openDatabase(':memory:')),
      now: () => clock.now,
      log: line => lines.push(line)
    })
    registries.push(registry)
    return { registry, lines }
  }
  const runs = async (registry: PluginRegistry) =>
    (await registry.get('counter')!.sandbox!.call('routes', 'GET /runs', {}, { householdId: null })) as {
      body: number
    }

  it('runs a task when it is due, once per period, and never again early after a restart', async () => {
    const clock = { now: 10 * 24 * 60 * MINUTE }
    const store = new PluginStore(openDatabase(':memory:'))
    const { registry } = await setUp({ counter: COUNTER }, clock, store)
    await registry.runDueTasks()
    assert.equal((await runs(registry)).body, 1)
    clock.now += 59 * MINUTE
    await registry.runDueTasks()
    assert.equal((await runs(registry)).body, 1)
    clock.now += MINUTE
    await registry.runDueTasks()
    assert.equal((await runs(registry)).body, 2)
    assert.equal(store.taskRuns('counter').purge, clock.now)
  })

  it('waits while the plugin is off, and logs a task that fails without trying again before its turn', async () => {
    const clock = { now: 10 * 24 * 60 * MINUTE }
    const { registry, lines } = await setUp({ counter: COUNTER }, clock)
    registry.store.setEnabled('counter', false)
    await registry.runDueTasks()
    registry.store.setEnabled('counter', true)
    assert.equal((await runs(registry)).body, 0)

    await registry.get('counter')!.sandbox!.call('routes', 'POST /fail', {}, { householdId: null })
    await registry.runDueTasks()
    assert.ok(lines.some(line => line.startsWith('[plugin counter] task purge failed')))
    const failures = lines.length
    clock.now += 10 * MINUTE
    await registry.runDueTasks()
    assert.equal(lines.length, failures)
  })

  it('refuses a plugin whose tasks are not well formed', async () => {
    const clock = { now: 0 }
    const { registry } = await setUp(
      {
        often: `export default { tasks: { purge: { every: 1, run: async () => {} } } }`,
        named: `export default { tasks: { Purge: { every: 60, run: async () => {} } } }`,
        empty: `export default { tasks: { purge: { every: 60 } } }`
      },
      clock
    )
    assert.match(registry.get('often')?.error ?? '', /every is a number of minutes, from 15 to 10080/)
    assert.match(registry.get('named')?.error ?? '', /lowercase letters/)
    assert.match(registry.get('empty')?.error ?? '', /must have a run function/)
  })

  it('runs a task for no household: what belongs to one is refused', async () => {
    const clock = { now: 10 * 24 * 60 * MINUTE }
    const { registry, lines } = await setUp(
      {
        lonely: `export default {
          tasks: { probe: { every: 15, run: async ctx => { await ctx.articles.get('x') } } }
        }`
      },
      clock
    )
    await registry.runDueTasks()
    assert.ok(lines.some(line => line.startsWith('[plugin lonely] task probe failed')))
  })
})
