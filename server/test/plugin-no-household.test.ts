import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { createApp } from '../app.ts'
import { LoginThrottle } from '../auth/login-throttle.ts'
import { hashPassword } from '../auth/password.ts'
import type { Config } from '../config.ts'
import { AccountDataStore } from '../db/account-data.ts'
import { openDatabase } from '../db/database.ts'
import { HouseholdStore } from '../db/household-store.ts'
import { PluginStore } from '../db/plugin-store.ts'
import { ProfileStore } from '../db/profile-store.ts'
import { UserAccountStore } from '../db/user-account-store.ts'
import { UserDeviceStore } from '../db/user-device-store.ts'
import { parseCatalog } from '../news/catalog.ts'
import { NewsService } from '../news/news-service.ts'
import { PLUGIN_API } from '../plugins/manifest.ts'
import { packageDigest } from '../plugins/package.ts'
import { loadPlugins } from '../plugins/registry.ts'
import { checkShape } from '../plugins/plugin-shape.ts'
import { fakeFetch } from './helpers/news.ts'

// A plugin's route marked noHousehold: true, which the account of someone who left their household still reaches,
// beside one that is not.

const ADMIN_PASSWORD = 'une phrase de passe assez longue'
const SAM_PASSWORD = 'la phrase de Sam'
const FAST = { N: 2 ** 10, r: 8, p: 1 }

const SERVER = `export default {
  routes: {
    'POST /mine': { noHousehold: true, handler: async request => ({ status: 201, body: { who: request.who } }) },
    'GET /notes': async request => ({ body: { who: request.who } })
  }
}`

const cookiesFrom = (response: Response) =>
  response.headers
    .getSetCookie()
    .map(cookie => cookie.split(';')[0])
    .join('; ')

// Signed, as the plugins that open such routes are.
const testKey = generateKeyPairSync('ed25519')
const TRUSTED = [testKey.publicKey.export({ type: 'spki', format: 'pem' }).toString()]

const writePlugin = (dir: string) => {
  const root = path.join(dir, 'club')
  mkdirSync(root, { recursive: true })
  const manifest = { id: 'club', name: 'Club', version: '0.1.0', description: 'Un club.', api: PLUGIN_API }
  writeFileSync(path.join(root, 'plugin.json'), JSON.stringify({ ...manifest, permissions: {} }))
  writeFileSync(path.join(root, 'server.js'), SERVER)
  writeFileSync(path.join(root, 'signature'), sign(null, packageDigest(root), testKey.privateKey).toString('base64'))
}

const config = (webDir: string): Config => ({
  host: '127.0.0.1',
  port: 0,
  sessionSecret: Buffer.alloc(32, 5),
  webDir,
  sourcesFile: 'unused.yml',
  databaseFile: ':memory:',
  backupDir: 'unused-backups',
  timeZone: 'UTC',
  vapid: { publicKey: 'unused', privateKey: 'unused', subject: 'mailto:test@example.com' }
})

// « Chez nous », with its admin Antho and Sam, an adult with an account, and the plugin « club ».
const start = async () => {
  const db = openDatabase(':memory:')
  const dir = mkdtempSync(path.join(tmpdir(), 'hodi-plugins-'))
  writePlugin(dir)
  const accounts = new UserAccountStore(db)
  const plugins = await loadPlugins({
    dir,
    trustedKeys: TRUSTED,
    dataDir: mkdtempSync(path.join(tmpdir(), 'hodi-plugin-data-')),
    store: new PluginStore(db),
    log: () => {}
  })
  const webDir = mkdtempSync(path.join(tmpdir(), 'hodi-web-'))
  writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>Hodi</title>')
  const server = createApp(config(webDir), {
    news: new NewsService(parseCatalog('topics:\n  - id: monde\n    label: Monde\n    sources: []\n'), {
      fetchText: fakeFetch({}).fetchText,
      log: () => {}
    }),
    profiles: new ProfileStore(db),
    household: new HouseholdStore(db),
    accounts,
    devices: new UserDeviceStore(db),
    accountData: new AccountDataStore(db),
    throttle: new LoginThrottle(5, 60_000),
    plugins
  }).listen(0)
  await new Promise(resolve => server.once('listening', resolve))
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const call = (url: string, cookie: string, method = 'GET', body?: unknown) =>
    fetch(`${baseUrl}/api${url}`, {
      method,
      headers: { cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  const session = cookiesFrom(
    await call('/setup/account', '', 'POST', { email: 'antho@example.com', password: ADMIN_PASSWORD })
  )
  const setup = await call('/setup', session, 'POST', {
    name: 'Chez nous',
    profile: { name: 'Antho', color: 'tech' },
    timeZone: 'Europe/Brussels',
    country: 'BE',
    ai: null
  })
  const admin = `${session}; ${cookiesFrom(setup)}`
  const { id: samId } = (await (
    await call('/profiles', admin, 'POST', { name: 'Sam', color: 'monde', kind: 'adult' })
  ).json()) as { id: number }
  const samAccount = accounts.create('sam@example.com', await hashPassword(SAM_PASSWORD, FAST), 0)!
  accounts.linkProfile(samAccount.id, samId)
  const sam = cookiesFrom(await call('/login', '', 'POST', { email: 'sam@example.com', password: SAM_PASSWORD }))
  return {
    call,
    admin,
    sam,
    samAccount,
    close: async () => {
      server.close()
      await plugins.stop()
    }
  }
}

describe('plugin routes open with no household', () => {
  it('lets an account in no household reach the routes marked noHousehold, and those alone', async () => {
    const env = await start()
    try {
      assert.equal((await env.call('/account/leave', env.sam, 'POST', { password: SAM_PASSWORD })).status, 204)
      const mine = await env.call('/plugins/club/mine', env.sam, 'POST', {})
      assert.equal(mine.status, 201)
      assert.deepEqual(((await mine.json()) as { who: unknown }).who, {
        profileId: null,
        householdId: null,
        kind: 'adult',
        householdAdmin: false,
        serverAdmin: false,
        accountId: env.samAccount.id
      })
      // The plugin's other routes, the list of plugins and anything of the household it left stay closed.
      for (const [url, method] of [
        ['/plugins/club/notes', 'GET'],
        ['/plugins', 'GET'],
        ['/plugins/club/settings', 'PUT'],
        ['/plugins/other/mine', 'POST'],
        ['/profiles', 'GET']
      ] as const) {
        const refused = await env.call(url, env.sam, method, method === 'GET' ? undefined : {})
        assert.deepEqual([refused.status, await refused.json()], [423, { error: 'no_household' }], url)
      }
    } finally {
      await env.close()
    }
  })

  it('serves the same route to someone in the household, with their household', async () => {
    const env = await start()
    try {
      const mine = await env.call('/plugins/club/mine', env.admin, 'POST', {})
      assert.equal(mine.status, 201)
      const { who } = (await mine.json()) as { who: { householdId: number | null; profileId: number | null } }
      assert.equal(typeof who.householdId, 'number')
      assert.equal(typeof who.profileId, 'number')
      assert.equal((await env.call('/plugins/club/notes', env.admin)).status, 200)
    } finally {
      await env.close()
    }
  })

  it('refuses noHousehold on a route of the server’s space or a public one', () => {
    const shape = {
      migrations: [],
      routes: [],
      serverRoutes: ['GET /all'],
      publicRoutes: ['GET /open'],
      hooks: [],
      tasks: {},
      feeds: [],
      aiActions: [],
      rawRoutes: {},
      proofRoutes: []
    }
    assert.throws(
      () => checkShape({ ...shape, noHouseholdRoutes: ['serverRoutes GET /all'] }),
      /only a route of routes can be open with no household/
    )
    assert.throws(
      () => checkShape({ ...shape, noHouseholdRoutes: ['publicRoutes GET /open'] }),
      /only a route of routes can be open with no household/
    )
    assert.doesNotThrow(() => checkShape({ ...shape, noHouseholdRoutes: [] }))
  })
})
