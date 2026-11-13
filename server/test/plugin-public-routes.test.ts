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

// The same public route, in a plugin whose manifest asks for it and in one whose manifest does not.
const SERVER = `export default {
  publicRoutes: {
    'GET /hello': async request => ({ body: { who: request.who, query: request.query } })
  }
}`

// The key the plugins with screens are signed with: only a signed plugin draws on the screens around sign-in.
const testKey = generateKeyPairSync('ed25519')
const TRUSTED = [testKey.publicKey.export({ type: 'spki', format: 'pem' }).toString()]

const writePlugin = (
  dir: string,
  id: string,
  permissions: Record<string, unknown>,
  { web = false, signed = false }: { web?: boolean; signed?: boolean } = {}
) => {
  const root = path.join(dir, id)
  mkdirSync(root, { recursive: true })
  const manifest = { id, name: id, version: '0.1.0', description: 'Ouvert à tous.', api: PLUGIN_API, permissions }
  writeFileSync(path.join(root, 'plugin.json'), JSON.stringify(manifest))
  writeFileSync(path.join(root, 'server.js'), SERVER)
  if (web) {
    writeFileSync(path.join(root, 'web.js'), `// ${id} once signed in`)
    writeFileSync(path.join(root, 'web-public.js'), `// ${id}'s screens`)
    mkdirSync(path.join(root, 'locales'))
    writeFileSync(path.join(root, 'locales', 'fr.json'), '{"hi":"Salut"}')
    mkdirSync(path.join(root, 'assets', 'demo'), { recursive: true })
    writeFileSync(path.join(root, 'assets', 'demo', 'page.html'), '<!doctype html><p>A demo</p>')
    writeFileSync(path.join(root, 'assets', 'demo', 'page.js'), '// its script')
    writeFileSync(path.join(root, 'assets', 'demo', 'Other.HTM'), '<!doctype html><p>Another</p>')
    writeFileSync(path.join(root, 'assets', 'demo', 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  }
  if (signed)
    writeFileSync(path.join(root, 'signature'), sign(null, packageDigest(root), testKey.privateKey).toString('base64'))
}

describe('public routes of plugins', () => {
  let baseUrl = ''
  let close = () => {}
  let plugins: PluginRegistry
  const lines: string[] = []

  const open = (id: string, headers: Record<string, string> = {}) =>
    fetch(`${baseUrl}/api/public/plugins/${id}/hello?from=test`, { headers })

  before(async () => {
    const db = openDatabase(':memory:')
    const dir = mkdtempSync(path.join(tmpdir(), 'hodi-plugins-'))
    writePlugin(dir, 'open', { publicRoutes: true })
    writePlugin(dir, 'closed', {})
    // Signed, with a web part: on the screens before sign-in only with publicRoutes.
    writePlugin(dir, 'landing', { publicRoutes: true }, { web: true, signed: true })
    writePlugin(dir, 'private', {}, { web: true, signed: true })
    writePlugin(dir, 'stranger', { publicRoutes: true }, { web: true })
    plugins = await loadPlugins({
      dir,
      trustedKeys: TRUSTED,
      dataDir: mkdtempSync(path.join(tmpdir(), 'hodi-plugin-data-')),
      store: new PluginStore(db),
      log: line => lines.push(line)
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
  })

  after(async () => {
    close()
    await plugins.stop()
  })

  it('stay closed until the setup is over', async () => {
    assert.equal((await open('open')).status, 404)
    assert.deepEqual(await (await fetch(`${baseUrl}/api/public/plugins`)).json(), { plugins: [] })
    assert.equal((await fetch(`${baseUrl}/api/public/plugins/landing/files/web-public.js`)).status, 404)
  })

  it('answer anyone once it is, with who null even for a signed-in device', async () => {
    const account = await fetch(`${baseUrl}/api/setup/account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'antho@example.com', password: 'une phrase de passe assez longue' })
    })
    const session = cookiesFrom(account)
    const setup = await fetch(`${baseUrl}/api/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: session },
      body: JSON.stringify({
        name: 'Chez nous',
        profile: { name: 'Antho', color: 'tech' },
        timeZone: 'Europe/Brussels',
        country: 'BE',
        ai: null
      })
    })
    assert.equal(setup.status, 200)
    const cookie = `${session}; ${cookiesFrom(setup)}`

    for (const headers of [{}, { cookie }]) {
      const answer = await open('open', headers)
      assert.equal(answer.status, 200)
      assert.deepEqual(await answer.json(), { who: null, query: { from: 'test' } })
      assert.equal(answer.headers.get('set-cookie'), null)
      assert.equal(answer.headers.get('content-security-policy'), "default-src 'none'; sandbox")
    }
  })

  it('are not served when the manifest does not ask for them, and the load says why', async () => {
    assert.equal((await open('closed')).status, 404)
    assert.ok(
      lines.includes('[plugin closed] publicRoutes not served: plugin.json does not ask for permissions.publicRoutes')
    )
  })

  it('stop while the plugin is off', async () => {
    plugins.store.setEnabled('open', false)
    assert.equal((await open('open')).status, 404)
    plugins.store.setEnabled('open', true)
    assert.equal((await open('open')).status, 200)
  })

  it('refuse a page of another site before the plugin runs', async () => {
    assert.equal((await open('open', { 'Sec-Fetch-Site': 'cross-site' })).status, 403)
  })

  it('list the signed plugins with screens before sign-in, once the setup is over and while they are on', async () => {
    const list = async () =>
      ((await (await fetch(`${baseUrl}/api/public/plugins`)).json()) as { plugins: { id: string }[] }).plugins
    assert.deepEqual(
      (await list()).map(plugin => plugin.id),
      ['landing']
    )
    const [landing] = (await (await fetch(`${baseUrl}/api/public/plugins`)).json()).plugins as Record<string, unknown>[]
    // Enough to load its public part, nothing of its settings, and never web.js.
    assert.deepEqual(Object.keys(landing ?? {}).sort(), ['id', 'name', 'version', 'web'])
    assert.deepEqual(landing?.web, {
      script: false,
      style: false,
      publicScript: true,
      publicStyle: false,
      locales: ['fr']
    })
    plugins.store.setEnabled('landing', false)
    assert.deepEqual(await list(), [])
    plugins.store.setEnabled('landing', true)
  })

  it('serve those plugins’ web files to anyone, and nothing else', async () => {
    const file = (id: string, name: string) => fetch(`${baseUrl}/api/public/plugins/${id}/files/${name}`)
    const script = await file('landing', 'web-public.js')
    assert.equal(script.status, 200)
    assert.equal(await script.text(), "// landing's screens")
    assert.equal((await file('landing', 'locales/fr.json')).status, 200)
    // Its own pages show in a frame of Hodi's page only, sandboxed in an origin of their own.
    const page = await file('landing', 'assets/demo/page.html')
    assert.equal(page.status, 200)
    const policy = page.headers.get('content-security-policy') ?? ''
    assert.match(policy, /^sandbox allow-scripts;/)
    assert.match(policy, /frame-ancestors 'self'/)
    assert.match(policy, /connect-src 'none'/)
    assert.match(policy, /img-src 'self' data:;/)
    assert.equal(page.headers.get('x-frame-options'), 'SAMEORIGIN')
    // So does any file a browser shows as a document, whatever the case of its extension.
    for (const name of ['assets/demo/Other.HTM', 'assets/demo/logo.svg']) {
      const other = await file('landing', name)
      assert.equal(other.status, 200, name)
      assert.match(other.headers.get('content-security-policy') ?? '', /^sandbox allow-scripts;/, name)
    }
    // Its other files keep Hodi's own headers: never shown in a frame.
    const asset = await file('landing', 'assets/demo/page.js')
    assert.equal(asset.status, 200)
    assert.equal(asset.headers.get('x-frame-options'), 'DENY')
    assert.match(asset.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/)
    for (const [id, name] of [
      ['landing', 'web.js'],
      ['landing', 'web.css'],
      ['landing', 'server.js'],
      ['landing', 'plugin.json'],
      ['landing', 'signature'],
      ['private', 'web-public.js'],
      ['stranger', 'web-public.js'],
      ['closed', 'web-public.js'],
      ['nobody', 'web-public.js']
    ] as const)
      assert.equal((await file(id, name)).status, 404, `${id}/${name}`)
    plugins.store.setEnabled('landing', false)
    assert.equal((await file('landing', 'web-public.js')).status, 404)
    plugins.store.setEnabled('landing', true)
  })
})
