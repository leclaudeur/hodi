import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { createApp } from '../app.ts'
import type { Config } from '../config.ts'
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
import { type PluginRegistry, loadPlugins } from '../plugins/registry.ts'
import { fakeFetch } from './helpers/news.ts'

const cookiesFrom = (response: Response) =>
  response.headers
    .getSetCookie()
    .map(cookie => cookie.split(';')[0])
    .join('; ')

const writePlugin = (dir: string, id: string, server?: string) => {
  mkdirSync(path.join(dir, id), { recursive: true })
  const manifest = {
    id,
    name: id === 'hello' ? 'Bonjour' : id,
    version: '0.1.0',
    description: 'Dit bonjour.',
    api: PLUGIN_API
  }
  writeFileSync(path.join(dir, id, 'plugin.json'), JSON.stringify(manifest))
  if (server !== undefined) writeFileSync(path.join(dir, id, 'server.js'), server)
}

const key = generateKeyPairSync('ed25519')
const trustedKeys = [key.publicKey.export({ type: 'spki', format: 'pem' }).toString()]
const signFolder = (root: string) =>
  writeFileSync(path.join(root, 'signature'), sign(null, packageDigest(root), key.privateKey).toString('base64'))

interface Found {
  plugins?: {
    id: string
    name: string
    description: string | null
    enabled: boolean
    signed: boolean
    error: string | null
  }[]
}

// « Plugins trouvés »: plugins put in data/plugins before the first start, listed right after the account.
describe('plugins found at the setup', () => {
  let baseUrl = ''
  let close = () => {}
  let session = ''
  let plugins: PluginRegistry

  const call = (url: string, cookie: string, method = 'GET', body?: unknown) =>
    fetch(`${baseUrl}/api${url}`, {
      method,
      headers: { cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body)
    })

  before(async () => {
    const db = openDatabase(':memory:')
    const dir = mkdtempSync(path.join(tmpdir(), 'hodi-plugins-'))
    writePlugin(dir, 'hello')
    writePlugin(dir, 'broken', 'export default 42')
    signFolder(path.join(dir, 'hello'))
    // Nobody signed it: the step offers it off.
    writePlugin(dir, 'loose')
    plugins = await loadPlugins({
      dir,
      dataDir: mkdtempSync(path.join(tmpdir(), 'hodi-plugin-data-')),
      trustedKeys,
      store: new PluginStore(db),
      log: () => {}
    })
    const webDir = mkdtempSync(path.join(tmpdir(), 'hodi-web-'))
    writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>Hodi</title>')
    const config: Config = {
      host: '127.0.0.1',
      port: 0,
      sessionSecret: Buffer.alloc(32, 5),
      webDir,
      sourcesFile: 'unused.yml',
      databaseFile: ':memory:',
      backupDir: 'unused-backups',
      timeZone: 'UTC',
      vapid: { publicKey: 'unused', privateKey: 'unused', subject: 'mailto:test@example.com' }
    }
    const catalog = parseCatalog('topics:\n  - id: monde\n    label: Monde\n    sources: []\n')
    const server = createApp(config, {
      news: new NewsService(catalog, { fetchText: fakeFetch({}).fetchText, log: () => {} }),
      profiles: new ProfileStore(db),
      household: new HouseholdStore(db),
      accounts: new UserAccountStore(db),
      devices: new UserDeviceStore(db),
      plugins
    }).listen(0)
    await new Promise(resolve => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    close = () => server.close()

    const account = await call('/setup/account', '', 'POST', {
      email: 'antho@example.com',
      password: 'une phrase de passe assez longue'
    })
    assert.equal(account.status, 204)
    session = cookiesFrom(account)
  })

  after(() => close())

  it('lists them to the signed-in server admin only, on by default, and says which are signed', async () => {
    const found = (await (await call('/setup', session)).json()) as Found
    assert.deepEqual(
      found.plugins?.map(({ id, name, enabled, signed, error }) => ({
        id,
        name,
        enabled,
        signed,
        broken: error !== null
      })),
      [
        { id: 'broken', name: 'broken', enabled: false, signed: false, broken: true },
        { id: 'hello', name: 'Bonjour', enabled: true, signed: true, broken: false },
        { id: 'loose', name: 'loose', enabled: true, signed: false, broken: false }
      ]
    )
    assert.equal(((await (await call('/setup', '')).json()) as Found).plugins, undefined)
  })

  it('turns off the unchecked ones and keeps them installed', async () => {
    assert.equal((await call('/setup/plugins', '', 'POST', { enabled: [] })).status, 401)
    assert.equal((await call('/setup/plugins', session, 'POST', { enabled: 'hello' })).status, 400)

    assert.equal((await call('/setup/plugins', session, 'POST', { enabled: [] })).status, 200)
    assert.equal(plugins.enabled('hello'), false)
    assert.ok(plugins.get('hello'))

    // Checked again; a broken one stays off whatever is sent.
    const saved = await call('/setup/plugins', session, 'POST', { enabled: ['hello', 'broken'] })
    assert.deepEqual(
      ((await saved.json()) as Found).plugins?.map(plugin => [plugin.id, plugin.enabled]),
      [
        ['broken', false],
        ['hello', true],
        ['loose', false]
      ]
    )
  })

  it('lets the server admin reach the plugins and the server routes in the middle of the setup, and nothing else', async () => {
    const listed = await call('/plugins', session)
    assert.equal(listed.status, 200)
    assert.ok(((await listed.json()) as Found).plugins?.some(plugin => plugin.id === 'hello'))
    // A plugin's server routes are its own business from here: hello has none.
    assert.equal((await call('/server/plugins/hello/anything', session)).status, 404)

    assert.equal((await call('/plugins', '')).status, 401)
    assert.equal((await call('/server/plugins/hello/anything', '')).status, 401)
    assert.deepEqual(await (await call('/profiles', session)).json(), { error: 'setup_required' })
  })

  it('is closed once the household is set up', async () => {
    const done = await call('/setup', session, 'POST', {
      name: 'Chez nous',
      profile: { name: 'Antho', color: 'tech' },
      timeZone: 'Europe/Brussels',
      ai: null
    })
    assert.equal(done.status, 200)
    assert.equal((await call('/setup/plugins', session, 'POST', { enabled: [] })).status, 409)
    assert.equal(plugins.enabled('hello'), true)
  })
})
