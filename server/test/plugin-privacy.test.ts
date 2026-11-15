import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { createApp } from '../app.ts'
import { LoginThrottle } from '../auth/login-throttle.ts'
import type { Config } from '../config.ts'
import { AccountDataStore } from '../db/account-data.ts'
import { openDatabase } from '../db/database.ts'
import { HouseholdStore } from '../db/household-store.ts'
import { PluginStore } from '../db/plugin-store.ts'
import { ProfileDeviceStore } from '../db/profile-device-store.ts'
import { ProfileStore } from '../db/profile-store.ts'
import { SignInCodeStore } from '../db/sign-in-code-store.ts'
import { UserAccountStore } from '../db/user-account-store.ts'
import { UserDeviceStore } from '../db/user-device-store.ts'
import { parseCatalog } from '../news/catalog.ts'
import { NewsService } from '../news/news-service.ts'
import { PLUGIN_API } from '../plugins/manifest.ts'
import { MAX_EXPORT_BYTES, type PluginRegistry, loadPlugins } from '../plugins/registry.ts'
import { fakeFetch } from './helpers/news.ts'

// A plugin that writes down each deletion it is told of, and hands its notes back for the copy.
const KEEPER = `export default {
  migrations: ['CREATE TABLE told (hook TEXT, subject TEXT)', 'CREATE TABLE failing (left INTEGER)'],
  routes: {
    'GET /told': async (_request, ctx) => ({ body: ctx.db.query('SELECT hook, subject FROM told ORDER BY rowid') }),
    'POST /fail': async (request, ctx) => { ctx.db.run('INSERT INTO failing (left) VALUES (?)', [request.body.times]); return { body: null } }
  },
  onProfileDeleted: async (deleted, ctx) => tell('onProfileDeleted', deleted, ctx),
  onAccountDeleted: async (deleted, ctx) => tell('onAccountDeleted', deleted, ctx),
  onHouseholdRemoved: async (removed, ctx) => tell('onHouseholdRemoved', removed, ctx),
  exportData: async (who, ctx) => ({ who, notes: ctx.db.query('SELECT count(*) AS n FROM told')[0].n })
}
const tell = (hook, subject, ctx) => {
  // Fails as many times as POST /fail asked, then writes it down.
  const [failing] = ctx.db.query('SELECT rowid, left FROM failing WHERE left > 0')
  if (failing) {
    ctx.db.run('UPDATE failing SET left = left - 1 WHERE rowid = ?', [failing.rowid])
    throw new Error('not now')
  }
  ctx.db.run('INSERT INTO told (hook, subject) VALUES (?, ?)', [hook, JSON.stringify(subject)])
}`

const manifest = (id: string) => ({
  id,
  name: id,
  version: '0.1.0',
  description: 'Keeps notes.',
  api: PLUGIN_API,
  audience: 'admin'
})

const registries: PluginRegistry[] = []
after(async () => {
  await Promise.all(registries.map(registry => registry.stop()))
})

const DAY = 24 * 60 * 60 * 1000

// The clock every registry reads, moved by the tests that wait for a retry or for kept data to expire.
let clock = 1_000_000

const start = async (
  plugins: Record<string, string>,
  {
    db = openDatabase(':memory:'),
    dir = mkdtempSync(path.join(tmpdir(), 'hodi-privacy-plugins-')),
    dataDir = mkdtempSync(path.join(tmpdir(), 'hodi-privacy-data-')),
    fetchTextFor
  }: {
    db?: ReturnType<typeof openDatabase>
    dir?: string
    dataDir?: string
    fetchTextFor?: Parameters<typeof loadPlugins>[0]['fetchTextFor']
  } = {}
) => {
  for (const [id, server] of Object.entries(plugins)) {
    mkdirSync(path.join(dir, id), { recursive: true })
    writeFileSync(
      path.join(dir, id, 'plugin.json'),
      JSON.stringify({ ...manifest(id), ...(fetchTextFor ? { permissions: { network: ['slow.test'] } } : {}) })
    )
    writeFileSync(path.join(dir, id, 'server.js'), server)
  }
  const store = new PluginStore(db)
  const logs: string[] = []
  const registry = await loadPlugins({
    dir,
    dataDir,
    store,
    now: () => clock,
    ...(fetchTextFor ? { fetchTextFor, isPublicUrl: async () => true } : {}),
    log: line => logs.push(line)
  })
  registries.push(registry)
  const told = async (id = 'keeper') =>
    (
      (await registry.get(id)!.sandbox!.call('routes', 'GET /told', {})) as {
        body: { hook: string; subject: string }[]
      }
    ).body.map(row => [row.hook, JSON.parse(row.subject) as unknown])
  return { registry, store, told, dir, dataDir, db, logs }
}

describe('plugins and deleted people', () => {
  it('tells every plugin with the hook, on or off, of a deleted profile, account and household', async () => {
    const { registry, store, told } = await start({
      keeper: KEEPER,
      // Off: still told, the person asked for their data to go.
      off: KEEPER,
      // No hook: nothing to tell it, nothing kept waiting for it.
      silent: `export default { routes: {} }`
    })
    store.setEnabled('off', false)
    registry.profileDeleted(5, 2)
    registry.accountDeleted(7)
    registry.householdRemoved(2)
    await registry.runErasures()
    const all = [
      ['onProfileDeleted', { profileId: 5, householdId: 2 }],
      ['onAccountDeleted', { accountId: 7 }],
      ['onHouseholdRemoved', { householdId: 2 }]
    ]
    assert.deepEqual(await told(), all)
    assert.deepEqual(await told('off'), all)
    assert.deepEqual(store.erasures(), [])
  })

  it('asks a plugin that failed again a minute later, ten times, then every hour, with one log line per pass', async () => {
    const { registry, store, told, logs } = await start({ keeper: KEEPER })
    await registry.get('keeper')!.sandbox!.call('routes', 'POST /fail', { body: { times: 10 } })
    registry.accountDeleted(7)
    await registry.runErasures()
    const tries = () => store.erasures().map(erasure => erasure.tries)
    assert.deepEqual(tries(), [1])
    // Not before its minute.
    await registry.runErasures()
    assert.deepEqual(tries(), [1])
    for (let minute = 0; minute < 9; minute++) {
      clock += 61_000
      await registry.runErasures()
    }
    assert.deepEqual(tries(), [10])
    // Then an hour apart.
    clock += 61_000
    await registry.runErasures()
    assert.deepEqual(tries(), [10])
    clock += 3_600_000
    await registry.runErasures()
    assert.deepEqual(await told(), [['onAccountDeleted', { accountId: 7 }]])
    assert.deepEqual(store.erasures(), [])
    // One line per pass that failed, not one per deletion.
    assert.equal(logs.filter(line => line.includes('1 deletions still waiting')).length, 10)
  })

  it('keeps what a plugin must forget until it answered, and drops it with the plugin', async () => {
    const { registry, store } = await start({ keeper: KEEPER })
    await registry.get('keeper')!.sandbox!.call('routes', 'POST /fail', { body: { times: 100 } })
    registry.profileDeleted(5, 1)
    await registry.runErasures()
    assert.equal(store.erasures().length, 1)
    await registry.forget('keeper')
    assert.deepEqual(store.erasures(), [])
  })

  it('keeps a deletion for a plugin removed with its data, and asks it at its reinstall', async () => {
    const first = await start({ keeper: KEEPER })
    const { db, dir, dataDir } = first
    await first.registry.stop()
    // Removed, its data kept for a reinstall.
    rmSync(path.join(dir, 'keeper'), { recursive: true })
    first.store.setRemoved('keeper', clock)
    const away = await start({}, { db, dir, dataDir })
    away.registry.accountDeleted(9)
    await away.registry.runErasures()
    assert.deepEqual(
      away.store.erasures().map(erasure => [erasure.pluginId, erasure.hook]),
      [['keeper', 'onAccountDeleted']]
    )
    await away.registry.stop()
    // Back: it hears of it at once, with its old data.
    const back = await start({ keeper: KEEPER }, { db, dir, dataDir })
    await back.registry.runErasures()
    assert.deepEqual(await back.told(), [['onAccountDeleted', { accountId: 9 }]])
    assert.deepEqual(back.store.erasures(), [])
  })

  it('deletes what a removed plugin kept, and what was set aside, after 30 days', async () => {
    const first = await start({ keeper: KEEPER })
    const { db, dir, dataDir } = first
    await first.registry.stop()
    rmSync(path.join(dir, 'keeper'), { recursive: true })
    first.store.setRemoved('keeper', clock)
    first.registry.accountDeleted(9)
    mkdirSync(path.join(dataDir, `other.orphan-${clock}`))
    mkdirSync(path.join(dataDir, `recent.orphan-${clock + 20 * DAY}`))
    clock += 31 * DAY
    const later = await start({}, { db, dir, dataDir })
    assert.deepEqual(readdirSync(dataDir), [`recent.orphan-${clock - 11 * DAY}`])
    assert.equal(later.store.ids().includes('keeper'), false)
    // Nothing is left to forget.
    assert.deepEqual(later.store.erasures(), [])
  })

  it('starts the 30 days of a plugin whose code went without a removal time', async () => {
    const first = await start({ keeper: KEEPER })
    const { db, dir, dataDir } = first
    await first.registry.stop()
    // Gone by hand, or before Hodi kept removal times.
    rmSync(path.join(dir, 'keeper'), { recursive: true })
    const away = await start({}, { db, dir, dataDir })
    assert.deepEqual(away.store.removedBefore(clock), ['keeper'])
    await away.registry.stop()
    clock += 31 * DAY
    const later = await start({}, { db, dir, dataDir })
    assert.equal(later.store.ids().includes('keeper'), false)
    assert.equal(existsSync(path.join(dataDir, 'keeper')), false)
  })

  it('adds each plugin’s part to the copy, or why it is missing', async () => {
    const { registry } = await start({
      keeper: KEEPER,
      big: `export default { exportData: async () => 'x'.repeat(${MAX_EXPORT_BYTES}) }`,
      broken: `export default { exportData: async () => { throw new Error('no') } }`,
      silent: `export default { routes: {} }`
    })
    assert.deepEqual(await registry.exportData({ accountId: 7, profileId: 5, householdId: 1 }), {
      keeper: { who: { accountId: 7, profileId: 5, householdId: 1 }, notes: 0 },
      big: { error: 'too_large' },
      broken: { error: 'unavailable' }
    })
  })
})

describe('Compte et données with plugins', () => {
  const PASSWORD = 'une phrase de passe assez longue'
  const SETUP = {
    name: 'Chez nous',
    profile: { name: 'Antho', color: 'tech' },
    timeZone: 'UTC',
    country: 'BE',
    ai: null
  }

  // A Hodi with its first adult signed in, and these plugins.
  const startHodi = async (plugins: Record<string, string>, options: Parameters<typeof start>[1] = {}) => {
    const db = openDatabase(':memory:')
    const { registry, told } = await start(plugins, { ...options, db })
    const webDir = mkdtempSync(path.join(tmpdir(), 'hodi-web-'))
    writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>Hodi</title>')
    const config: Config = {
      host: '127.0.0.1',
      port: 0,
      sessionSecret: Buffer.alloc(32, 2),
      webDir,
      sourcesFile: 'unused.yml',
      databaseFile: ':memory:',
      backupDir: 'unused-backups',
      timeZone: 'UTC',
      vapid: { publicKey: 'unused', privateKey: 'unused', subject: 'mailto:test@example.com' }
    }
    const profiles = new ProfileStore(db)
    const server = createApp(config, {
      news: new NewsService(parseCatalog('topics:\n  - id: monde\n    label: Monde\n    sources: []\n'), {
        fetchText: fakeFetch({}).fetchText,
        log: () => {}
      }),
      profiles,
      household: new HouseholdStore(db),
      accounts: new UserAccountStore(db),
      devices: new UserDeviceStore(db),
      profileDevices: new ProfileDeviceStore(db),
      accountData: new AccountDataStore(db),
      codes: new SignInCodeStore(db, config.sessionSecret),
      plugins: registry,
      throttle: new LoginThrottle(5, 60_000)
    }).listen(0)
    after(() => server.close())
    await new Promise(resolve => server.once('listening', resolve))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`
    const send = (url: string, body: unknown, cookie = '', method = 'POST') =>
      fetch(`${base}${url}`, {
        method,
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify(body)
      })
    const cookiesOf = (response: Response) =>
      response.headers
        .getSetCookie()
        .map(cookie => cookie.split(';')[0])
        .join('; ')
    let cookie = cookiesOf(await send('/setup/account', { email: 'antho@example.com', password: PASSWORD }))
    const done = await send('/setup', SETUP, cookie)
    assert.equal(done.status, 200)
    cookie = `${cookie}; ${cookiesOf(done)}`
    const copy = () => fetch(`${base}/account/copy`, { headers: { cookie } })
    return { registry, told, send, cookie, copy, profileId: profiles.list()[0]!.id }
  }

  it('puts the plugins in the copy, and has them forget a deleted account with its profile and household', async () => {
    const { registry, told, send, cookie, copy, profileId } = await startHodi({ keeper: KEEPER })
    const copied = (await (await copy()).json()) as { plugins: Record<string, unknown> }
    assert.deepEqual(copied.plugins, { keeper: { who: { accountId: 1, profileId, householdId: 1 }, notes: 0 } })

    // The last adult: the account, its profile and the household go, and the plugin hears of all three.
    assert.equal((await send('/account', { password: PASSWORD }, cookie, 'DELETE')).status, 204)
    await registry.runErasures()
    assert.deepEqual(await told(), [
      ['onProfileDeleted', { profileId, householdId: 1 }],
      ['onAccountDeleted', { accountId: 1 }],
      ['onHouseholdRemoved', { householdId: 1 }]
    ])
  })

  it('makes one copy at a time for an account, and a few a minute', async () => {
    // A plugin slow to answer its part.
    const { copy } = await startHodi(
      {
        slow: `export default { exportData: async (who, ctx) => { await ctx.fetchText('https://slow.test/'); return 'done' } }`
      },
      {
        fetchTextFor: () => async url => {
          await new Promise(resolve => setTimeout(resolve, 300))
          return { url, text: '' }
        }
      }
    )
    const statuses = (await Promise.all(Array.from({ length: 10 }, () => copy()))).map(response => response.status)
    assert.deepEqual(statuses.sort(), [200, ...Array(9).fill(429)])
    // The minute's copies are used up.
    assert.equal((await copy()).status, 429)
  })
})
