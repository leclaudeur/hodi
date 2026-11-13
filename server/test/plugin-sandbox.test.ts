import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import {
  MAX_WAITING_CALLS,
  MAX_WAITING_EXPORTS,
  MAX_WAITING_HOOKS,
  SIGN_IN_WAIT_MS,
  PluginSandbox,
  SandboxError,
  type SandboxOptions,
  runningThreads,
  sandboxBudget,
  threadCostMb
} from '../plugins/sandbox/sandbox.ts'
import { SqlRefused, checkPluginSql } from '../plugins/sandbox/sql-guard.ts'
import { databasePath, loadSqliteWasm } from '../plugins/sandbox/sqlite-wasm.ts'

const folder = mkdtempSync(path.join(tmpdir(), 'hodi-sandbox-'))
const sandboxes: PluginSandbox[] = []

after(async () => {
  await Promise.all(sandboxes.map(sandbox => sandbox.stop()))
  rmSync(folder, { recursive: true, force: true })
})

let count = 0
const sandboxOf = (source: string, options: Partial<SandboxOptions> = {}) => {
  count += 1
  const sandbox = new PluginSandbox({
    id: `test-${count}`,
    source,
    dbFile: path.join(folder, `plugin-${count}.db`),
    timeoutMs: 1_000,
    host: {
      requests: { fetchText: async ([url]) => ({ url, text: `text of ${String(url)}` }) },
      log: () => {},
      settings: () => ({ greeting: 'bonjour' })
    },
    ...options
  })
  sandboxes.push(sandbox)
  return sandbox
}

// A plugin with one route whose body is the given code, run with (request, ctx).
const routePlugin = (body: string, extra = '', options: Partial<SandboxOptions> = {}) =>
  sandboxOf(`export default { ${extra} routes: { 'GET /x': async (request, ctx) => { ${body} } } }`, options)

// A plugin whose route waits as long as asked, through a host request (the engine has no timers).
const slowPlugin = (options: Partial<SandboxOptions> = {}) =>
  routePlugin(`await ctx.fetchText(String(request)); return 'slept'`, '', {
    host: {
      requests: {
        fetchText: async ([ms]) => {
          await new Promise(resolve => setTimeout(resolve, Number(ms)))
          return { url: '', text: '' }
        }
      },
      log: () => {},
      settings: () => ({})
    },
    ...options
  })

const failsWith = async (work: Promise<unknown>, code: SandboxError['code']) => {
  await assert.rejects(work, (error: unknown) => error instanceof SandboxError && error.code === code)
}

describe('plugin sandbox', () => {
  it('says what the plugin exports and answers its routes', async () => {
    const sandbox = sandboxOf(`export default {
      migrations: ['CREATE TABLE notes (text TEXT)'],
      routes: { 'GET /hello': async (request, ctx) => ({ body: { hi: request.name, setting: ctx.settings().greeting } }) },
      publicRoutes: { 'GET /open': async () => 1 },
      onArticle: async () => null
    }`)
    const shape = await sandbox.start()
    assert.deepEqual(shape, {
      migrations: 1,
      routes: ['GET /hello'],
      serverRoutes: [],
      publicRoutes: ['GET /open'],
      hooks: ['onArticle'],
      tasks: {},
      feeds: [],
      aiActions: [],
      rawRoutes: {},
      proofRoutes: []
    })
    assert.deepEqual(await sandbox.call('routes', 'GET /hello', { name: 'Léa' }), {
      body: { hi: 'Léa', setting: 'bonjour' }
    })
    await failsWith(sandbox.call('routes', 'GET /missing', null), 'plugin_error')
    // A name from Object.prototype is not a route.
    await failsWith(sandbox.call('routes', 'constructor', null), 'plugin_error')
  })

  it('keeps the plugin away from Node, the network and shared memory', async () => {
    const sandbox = routePlugin(`return {
      require: typeof require, process: typeof process, fetch: typeof fetch, buffer: typeof Buffer,
      shared: typeof SharedArrayBuffer, bridge: typeof __hodi, ctx: Object.keys(ctx).sort()
    }`)
    assert.deepEqual(await sandbox.call('routes', 'GET /x', null), {
      require: 'undefined',
      process: 'undefined',
      fetch: 'undefined',
      buffer: 'undefined',
      shared: 'undefined',
      bridge: 'undefined',
      ctx: ['articles', 'db', 'fetchText', 'http', 'id', 'log', 'serverSettings', 'settings']
    })
  })

  it('takes the bridge away before the first line of the plugin runs', async () => {
    const sandbox = sandboxOf(`
      const seen = [typeof globalThis.__hodi, typeof __hodi]
      export default { routes: { 'GET /x': async () => seen } }
    `)
    assert.deepEqual(await sandbox.call('routes', 'GET /x', null), ['undefined', 'undefined'])
  })

  it('ends work a call left running past its time limit, without waiting for a next call', async () => {
    const sandbox = routePlugin(`
      if (request.leave) ctx.fetchText('https://example.test/').then(() => { for (;;) {} })
      return 'fine'
    `)
    assert.equal(await sandbox.call('routes', 'GET /x', { leave: true }), 'fine')
    // The thread spins for its time limit (1 s), is ended, and the next call finds a new one at once.
    await new Promise(resolve => setTimeout(resolve, 1_500))
    const started = Date.now()
    assert.equal(await sandbox.call('routes', 'GET /x', { leave: false }), 'fine')
    assert.ok(Date.now() - started < 900)
  })

  it('refuses a plugin that imports a module', async () => {
    const sandbox = sandboxOf(`import { readFileSync } from 'node:fs'\nexport default { routes: {} }`)
    await failsWith(sandbox.start(), 'failed')
  })

  it('keeps its database between starts and runs each migration once', async () => {
    const dbFile = path.join(folder, 'kept.db')
    const source = `export default {
      migrations: ['CREATE TABLE notes (text TEXT)'],
      routes: {
        'POST /note': async (request, ctx) => ctx.db.run('INSERT INTO notes (text) VALUES (?)', [request.text]),
        'GET /notes': async (request, ctx) => ctx.db.query('SELECT text FROM notes')
      }
    }`
    const first = sandboxOf(source, { dbFile })
    assert.deepEqual(await first.call('routes', 'POST /note', { text: 'un' }), { changes: 1, lastInsertRowid: 1 })
    await first.stop()
    const second = sandboxOf(source, { dbFile })
    assert.deepEqual(await second.call('routes', 'GET /notes', null), [{ text: 'un' }])
  })

  it('turns a refused statement into an exception in the plugin', async () => {
    const sandbox = routePlugin(`
      const tries = ["ATTACH DATABASE '/tmp/other.db' AS other", 'PRAGMA writable_schema = ON',
        'DELETE FROM hodi_migrations', 'SELECT 1; DROP TABLE notes', 'SELECT * FROM sqlite_master']
      return tries.map(sql => { try { ctx.db.query(sql); return 'ran' } catch (error) { return error.message } })
    `)
    assert.deepEqual(await sandbox.call('routes', 'GET /x', null), [
      'not_allowed:ATTACH DATABASE',
      'not_allowed:PRAGMA WRITABLE_SCHEMA',
      'reserved_name:hodi_migrations',
      'one_statement_only',
      'reserved_name:sqlite_master'
    ])
  })

  it('answers fetchText through Hodi', async () => {
    const sandbox = routePlugin(`return await ctx.fetchText('https://example.test/feed')`)
    assert.deepEqual(await sandbox.call('routes', 'GET /x', null), {
      url: 'https://example.test/feed',
      text: 'text of https://example.test/feed'
    })
  })

  it('refuses a request Hodi was not given, and passes the call context to the others', async () => {
    let seen: unknown = null
    const sandbox = routePlugin(
      `const refused = await ctx.articles.get('a1').then(() => 'ran', error => error.message)
      return { refused, fetched: await ctx.fetchText('https://example.test/') }`,
      '',
      {
        host: {
          requests: {
            fetchText: async ([url], context) => {
              seen = context
              return { url, text: '' }
            }
          },
          log: () => {},
          settings: () => ({})
        }
      }
    )
    assert.deepEqual(await sandbox.call('routes', 'GET /x', null, { householdId: 7 }), {
      refused: 'not_allowed',
      fetched: { url: 'https://example.test/', text: '' }
    })
    assert.deepEqual(seen, { householdId: 7 })
  })

  it('turns text into UTF-8 bytes and back', async () => {
    const sandbox = routePlugin(`
      const text = 'Hodi · été 🌧️ ok'
      const bytes = new TextEncoder().encode(text)
      return { same: new TextDecoder().decode(bytes) === text, length: bytes.length, bad: new TextDecoder().decode(new Uint8Array([0x61, 0xff, 0x62])) }
    `)
    assert.deepEqual(await sandbox.call('routes', 'GET /x', null), {
      same: true,
      length: new TextEncoder().encode('Hodi · été 🌧️ ok').length,
      bad: 'a\uFFFDb'
    })
  })

  it('gives random bytes through crypto.getRandomValues and randomUUID, never crypto.subtle', async () => {
    const sandbox = routePlugin(`
      const a = crypto.getRandomValues(new Uint8Array(32))
      const b = crypto.getRandomValues(new Uint32Array(8))
      let tooBig = null
      try { crypto.getRandomValues(new Uint8Array(65537)) } catch (error) { tooBig = error.name }
      let notInteger = null
      try { crypto.getRandomValues(new Float64Array(2)) } catch (error) { notInteger = error.name }
      return {
        a: a.length, distinct: new Set(a).size > 8, b: b.some(value => value !== 0),
        tooBig, notInteger, subtle: typeof crypto.subtle,
        uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(crypto.randomUUID()),
        differ: crypto.randomUUID() !== crypto.randomUUID()
      }
    `)
    assert.deepEqual(await sandbox.call('routes', 'GET /x', null), {
      a: 32,
      distinct: true,
      b: true,
      tooBig: 'RangeError',
      notInteger: 'TypeError',
      subtle: 'undefined',
      uuid: true,
      differ: true
    })
  })

  it('keeps BLOBs as bytes, both ways', async () => {
    const sandbox = routePlugin(
      `const bytes = new Uint8Array([0, 1, 254, 255])
      ctx.db.run('INSERT INTO files (name, data) VALUES (?, ?)', ['a', bytes])
      ctx.db.run('INSERT INTO files (name, data) VALUES (?, ?)', ['b', bytes.buffer])
      const rows = ctx.db.query('SELECT name, data, length(data) AS size FROM files ORDER BY name')
      return rows.map(row => ({ name: row.name, size: row.size, bytes: row.data instanceof Uint8Array ? [...row.data] : null }))`,
      `migrations: ['CREATE TABLE files (name TEXT, data BLOB)'],`
    )
    assert.deepEqual(await sandbox.call('routes', 'GET /x', null), [
      { name: 'a', size: 4, bytes: [0, 1, 254, 255] },
      { name: 'b', size: 4, bytes: [0, 1, 254, 255] }
    ])
  })

  it('hands a raw body to the handler as bytes, and reads a value for Hodi without the engine', async () => {
    const sandbox = sandboxOf(`export default {
      migrations: ['CREATE TABLE captures (id INTEGER PRIMARY KEY, data BLOB)'],
      routes: {
        'PUT /capture': { raw: true, maxBody: 1000, handler: async (request, ctx) => {
          const isPng = request.body[0] === 0x89 && request.body[1] === 0x50
          ctx.db.run('INSERT INTO captures (data) VALUES (?)', [request.body])
          return { isPng, size: request.body.length }
        } }
      }
    }`)
    const shape = await sandbox.start()
    assert.deepEqual(shape.rawRoutes, { 'routes PUT /capture': 1000 })
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    assert.deepEqual(await sandbox.call('routes', 'PUT /capture', { body: null }, null, png), { isPng: true, size: 7 })
    assert.deepEqual([...(await sandbox.read('SELECT data FROM captures WHERE id = ?', [1]))], [...png])
    await failsWith(sandbox.read('DELETE FROM captures', []), 'plugin_error')
    await failsWith(sandbox.read('SELECT data FROM captures WHERE id = ?', [9]), 'plugin_error')
    await failsWith(sandbox.read("ATTACH 'x.db' AS x", []), 'plugin_error')
  })

  it('lists the routes that ask for the password first, and refuses anything but true or false', async () => {
    const sandbox = sandboxOf(`export default {
      routes: {
        'DELETE /all': { proof: true, handler: async () => ({}) },
        'PUT /photo': { raw: true, maxBody: 10, proof: true, handler: async () => ({}) },
        'GET /all': { proof: false, handler: async () => ({}) }
      },
      serverRoutes: { 'DELETE /all': { proof: true, handler: async () => ({}) } }
    }`)
    const shape = await sandbox.start()
    assert.deepEqual(shape.proofRoutes, ['routes DELETE /all', 'routes PUT /photo', 'serverRoutes DELETE /all'])
    await failsWith(
      sandboxOf(`export default { routes: { 'DELETE /all': { proof: 'yes', handler: async () => ({}) } } }`).start(),
      'failed'
    )
  })

  it("refuses a plugin that imports Hodi's own modules", async () => {
    const sandbox = sandboxOf(`import { setSettings } from 'hodi:prelude'\nexport default { routes: {} }`)
    await failsWith(sandbox.start(), 'failed')
  })

  it('stops endless code, then starts again for the next call', async () => {
    const sandbox = routePlugin(`if (request.spin) for (;;) {} return 'fine'`)
    await failsWith(sandbox.call('routes', 'GET /x', { spin: true }), 'timeout')
    assert.equal(await sandbox.call('routes', 'GET /x', { spin: false }), 'fine')
  })

  it('stops an endless chain of promises', async () => {
    const sandbox = routePlugin(
      `const again = () => Promise.resolve().then(again); again(); return new Promise(() => {})`
    )
    await failsWith(sandbox.call('routes', 'GET /x', null), 'timeout')
  })

  it('stops an endless query', async () => {
    const sandbox = routePlugin(`
      if (!request.endless) return 'fine'
      return ctx.db.get('WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM r) SELECT count(*) AS c FROM r')
    `)
    await failsWith(sandbox.call('routes', 'GET /x', { endless: true }), 'timeout')
    assert.equal(await sandbox.call('routes', 'GET /x', { endless: false }), 'fine')
  })

  it('stops the plugin at its memory budget', async () => {
    const sandbox = routePlugin(`
      if (!request.grow) return 'fine'
      const kept = []
      for (;;) kept.push('x'.repeat(1_000_000) + kept.length)
    `)
    await failsWith(sandbox.call('routes', 'GET /x', { grow: true }), 'out_of_memory')
    assert.equal(await sandbox.call('routes', 'GET /x', { grow: false }), 'fine')
  })

  it('makes a query that needs too much memory fail in the plugin', async () => {
    const sandbox = routePlugin(
      `
      try {
        ctx.db.get("WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM r WHERE n < 3000000) SELECT group_concat(randomblob(100)) AS c FROM r")
        return 'ran'
      } catch (error) { return error.message }
    `,
      '',
      // Filling SQLite's heap takes about a second and a half on a slow machine.
      { timeoutMs: 5_000 }
    )
    assert.equal(await sandbox.call('routes', 'GET /x', null), 'out of memory')
  })

  it('stops a database at its size', async () => {
    const sandbox = routePlugin(
      `try { for (;;) ctx.db.run('INSERT INTO junk (data) VALUES (zeroblob(100000))') } catch (error) { return error.message }`,
      `migrations: ['CREATE TABLE junk (data BLOB)'],`,
      { databaseMb: 1 }
    )
    assert.equal(await sandbox.call('routes', 'GET /x', null), 'database or disk is full')
  })

  it('refuses a result over its size', async () => {
    const sandbox = routePlugin(`return 'x'.repeat(2 * 1024 * 1024)`)
    await failsWith(sandbox.call('routes', 'GET /x', null), 'plugin_error')
  })

  it('runs threads within one memory budget, ending the one used least recently to make room', async () => {
    const all = Array.from({ length: 4 }, () => routePlugin(`return ctx.id`))
    for (const sandbox of all) assert.match(String(await sandbox.call('routes', 'GET /x', null)), /^test-/)
    // The first ones were ended, and start again when asked.
    assert.match(String(await all[0]!.call('routes', 'GET /x', null)), /^test-/)
  })

  it('makes a call wait for room while another plugin runs, then refuses it', async () => {
    const saved = sandboxBudget.mb
    // Room for one thread at a time.
    sandboxBudget.mb = threadCostMb(16) + 1
    try {
      const slow = slowPlugin({ maxWaitMs: 300 })
      const other = routePlugin(`return 'other'`, '', { maxWaitMs: 300 })
      const running = slow.call('routes', 'GET /x', 800)
      await new Promise(resolve => setTimeout(resolve, 100))
      await failsWith(other.call('routes', 'GET /x', null), 'busy')
      assert.equal(await running, 'slept')
      // Once the slow one is idle, it makes room.
      assert.equal(await other.call('routes', 'GET /x', null), 'other')
    } finally {
      sandboxBudget.mb = saved
    }
  })

  it('never lets two waiters take the same room', async () => {
    const saved = sandboxBudget.mb
    sandboxBudget.mb = threadCostMb(16)
    try {
      const slow = slowPlugin({ maxWaitMs: 5_000 })
      await slow.start()
      const waiters = [
        routePlugin(`return 'b'`, '', { maxWaitMs: 5_000 }),
        routePlugin(`return 'c'`, '', { maxWaitMs: 5_000 })
      ]
      let most = 0
      const watch = setInterval(() => (most = Math.max(most, runningThreads())), 5)
      const running = slow.call('routes', 'GET /x', 800)
      await new Promise(resolve => setTimeout(resolve, 50))
      const answers = await Promise.all(waiters.map(sandbox => sandbox.call('routes', 'GET /x', null)))
      clearInterval(watch)
      assert.equal(await running, 'slept')
      assert.deepEqual(answers, ['b', 'c'])
      assert.equal(most, 1)
    } finally {
      sandboxBudget.mb = saved
    }
  })

  it('refuses a plugin that could never fit in the budget', async () => {
    const saved = sandboxBudget.mb
    sandboxBudget.mb = threadCostMb(16) - 1
    try {
      await failsWith(routePlugin(`return 1`).call('routes', 'GET /x', null), 'failed')
    } finally {
      sandboxBudget.mb = saved
    }
  })

  it('lets only a few calls wait, and not for long', async () => {
    const sandbox = slowPlugin()
    const calls = Array.from({ length: MAX_WAITING_CALLS + 4 }, () => sandbox.call('routes', 'GET /x', 50))
    const results = await Promise.allSettled(calls)
    const done = results.filter(result => result.status === 'fulfilled').length
    // The first one runs at once and MAX_WAITING_CALLS wait for it; the rest are refused.
    assert.equal(done, MAX_WAITING_CALLS + 1)
    for (const result of results.filter(result => result.status === 'rejected')) {
      assert.equal((result.reason as SandboxError).code, 'busy')
    }
    const waiter = slowPlugin({ maxWaitMs: 200 })
    const first = waiter.call('routes', 'GET /x', 600)
    await failsWith(waiter.call('routes', 'GET /x', 0), 'busy')
    assert.equal(await first, 'slept')
  })

  it('answers a sign-in while public routes fill the queue, ahead of them and within a short wait', async () => {
    const sandbox = routePlugin(
      `await ctx.fetchText(String(request)); return 'slept'`,
      `checkSignIn: async () => ({ allow: true }),`,
      {
        maxWaitMs: 10_000,
        timeoutMs: SIGN_IN_WAIT_MS + 3_000,
        host: {
          requests: {
            fetchText: async ([ms]) => {
              await new Promise(resolve => setTimeout(resolve, Number(ms)))
              return { url: '', text: '' }
            }
          },
          log: () => {},
          settings: () => ({})
        }
      }
    )
    // Its thread started first, so that only the queue counts below.
    assert.equal(await sandbox.call('routes', 'GET /x', 0), 'slept')
    await new Promise(resolve => setImmediate(resolve))
    // One route runs, MAX_WAITING_CALLS wait: the routes' queue is full.
    const routes = Array.from({ length: MAX_WAITING_CALLS + 1 }, () => sandbox.call('routes', 'GET /x', 100))
    await failsWith(sandbox.call('routes', 'GET /x', 0), 'busy')
    const started = Date.now()
    assert.deepEqual(await sandbox.call('hook', 'checkSignIn', {}), { allow: true })
    // Only the route already running was ahead of it, not the eight waiting.
    assert.ok(Date.now() - started < 100 * 3, `answered after ${Date.now() - started} ms`)
    await Promise.all(routes)

    // Behind a call that never ends, a sign-in waits SIGN_IN_WAIT_MS at most, not the routes' maxWaitMs.
    const stuck = sandbox.call('routes', 'GET /x', SIGN_IN_WAIT_MS + 1_500).catch((error: unknown) => error)
    const waited = Date.now()
    await failsWith(sandbox.call('hook', 'checkSignIn', {}), 'busy')
    assert.ok(Date.now() - waited < SIGN_IN_WAIT_MS + 1_000)
    assert.equal(await stuck, 'slept')
  })

  it('lets only two copies wait, after the sign-ins and before the routes', async () => {
    const order: string[] = []
    const sandbox = sandboxOf(
      `export default {
        routes: { 'GET /x': async (request, ctx) => { await ctx.fetchText('route'); return 'route' } },
        exportData: async (who, ctx) => { await ctx.fetchText('copy'); return 'copy' },
        checkSignIn: async (who, ctx) => { await ctx.fetchText('sign-in'); return null }
      }`,
      {
        host: {
          requests: {
            fetchText: async ([what]) => {
              order.push(String(what))
              await new Promise(resolve => setTimeout(resolve, 30))
              return { url: '', text: '' }
            }
          },
          log: () => {},
          settings: () => ({})
        }
      }
    )
    await sandbox.call('routes', 'GET /x', null)
    await new Promise(resolve => setImmediate(resolve))
    order.length = 0
    const running = sandbox.call('routes', 'GET /x', null)
    const route = sandbox.call('routes', 'GET /x', null)
    const copies = Array.from({ length: MAX_WAITING_EXPORTS + 2 }, () => sandbox.call('hook', 'exportData', {}))
    const signIn = sandbox.call('hook', 'checkSignIn', {})
    const settled = await Promise.allSettled([running, route, signIn, ...copies])
    // The running route, then the sign-in, then the copies that could wait, then the route.
    assert.deepEqual(order, ['route', 'sign-in', ...Array(MAX_WAITING_EXPORTS).fill('copy'), 'route'])
    assert.deepEqual(
      settled.slice(3).map(result => (result.status === 'rejected' ? (result.reason as SandboxError).code : 'ok')),
      [...Array(MAX_WAITING_EXPORTS).fill('ok'), 'busy', 'busy']
    )
  })

  it('runs routes before onArticle, and drops onArticle calls past a few', async () => {
    const order: string[] = []
    const sandbox = sandboxOf(
      `export default {
        routes: { 'GET /x': async (request, ctx) => { await ctx.fetchText(request); return 'route' } },
        onArticle: async (article, ctx) => { await ctx.fetchText('hook') }
      }`,
      {
        host: {
          requests: {
            fetchText: async ([what]) => {
              order.push(String(what))
              await new Promise(resolve => setTimeout(resolve, 30))
              return { url: '', text: '' }
            }
          },
          log: () => {},
          settings: () => ({})
        }
      }
    )
    const first = sandbox.call('routes', 'GET /x', 'first')
    const hooks = Array.from({ length: MAX_WAITING_HOOKS + 2 }, () => sandbox.call('hook', 'onArticle', {}))
    const second = sandbox.call('routes', 'GET /x', 'second')
    const settled = await Promise.allSettled([first, second, ...hooks])
    assert.deepEqual(order.slice(0, 2), ['first', 'second'])
    assert.equal(order.filter(what => what === 'hook').length, MAX_WAITING_HOOKS)
    assert.equal(settled.filter(result => result.status === 'rejected').length, 2)
  })

  it('gives work left running after a call no context', async () => {
    const seen: unknown[] = []
    const sandbox = routePlugin(
      `ctx.fetchText('now').then(() => ctx.fetchText('later'))
      return 'done'`,
      '',
      {
        host: {
          requests: {
            fetchText: async ([url], context) => {
              seen.push([url, context])
              return { url, text: '' }
            }
          },
          log: () => {},
          settings: () => ({})
        }
      }
    )
    assert.equal(await sandbox.call('routes', 'GET /x', null, { householdId: 7 }), 'done')
    await new Promise(resolve => setTimeout(resolve, 200))
    assert.deepEqual(seen, [
      ['now', { householdId: 7 }],
      ['later', null]
    ])
  })

  it('refuses calls once stopped', async () => {
    const sandbox = routePlugin(`return 1`)
    await sandbox.stop()
    await failsWith(sandbox.call('routes', 'GET /x', null), 'stopped')
  })
})

describe('plugin database files', () => {
  it('opens no other file, even for SQL past the guard', () => {
    const own = path.join(folder, 'own.db')
    const other = path.join(folder, 'other.db')
    const { Database } = loadSqliteWasm(own)
    const database = new Database(databasePath(own))
    database.exec('CREATE TABLE t (a)')
    assert.throws(() => database.exec(`ATTACH DATABASE '${other}' AS other`))
    assert.throws(() => database.exec(`VACUUM INTO '${other}'`))
    assert.equal(existsSync(other), false)
    database.close()
  })
})

describe('plugin SQL guard', () => {
  it('lets a plugin read, write and shape its own tables', () => {
    for (const sql of [
      'SELECT * FROM notes WHERE text = ?',
      "INSERT INTO notes (text) VALUES ('a;b')",
      'CREATE TABLE notes (text TEXT)',
      'CREATE UNIQUE INDEX notes_text ON notes (text)',
      'WITH n AS (SELECT 1) SELECT * FROM n;',
      'UPDATE notes SET text = "x" -- a comment; DROP TABLE notes'
    ]) {
      assert.equal(checkPluginSql(sql), sql)
    }
  })

  it('refuses what reaches beyond its database', () => {
    for (const sql of [
      "ATTACH 'x.db' AS x",
      "VACUUM INTO '/tmp/copy.db'",
      'PRAGMA journal_mode = OFF',
      "SELECT load_extension('x')",
      'SELECT * FROM pragma_table_info("notes")',
      'SELECT * FROM "hodi_migrations"',
      'SELECT 1; SELECT 2',
      'CREATE TRIGGER t AFTER INSERT ON notes BEGIN SELECT 1; END',
      'CREATE VIEW v AS SELECT 1',
      '',
      '  -- only a comment'
    ]) {
      assert.throws(() => checkPluginSql(sql), SqlRefused, sql)
    }
  })
})
