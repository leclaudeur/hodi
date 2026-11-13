import assert from 'node:assert/strict'
import { type KeyObject, createPublicKey, generateKeyPairSync, sign } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { request as httpRequest } from 'node:http'
import { unzipSync } from 'fflate'
import { create as createTar } from 'tar'
import { createApp } from '../app.ts'
import { hashPassword } from '../auth/password.ts'
import type { Config } from '../config.ts'
import { openDatabase } from '../db/database.ts'
import { HouseholdStore } from '../db/household-store.ts'
import { ServerSettingsStore, publicServerSettings } from '../db/server-settings-store.ts'
import { PluginStore } from '../db/plugin-store.ts'
import { ProfileStore } from '../db/profile-store.ts'
import { UserDeviceStore } from '../db/user-device-store.ts'
import { UserAccountStore } from '../db/user-account-store.ts'
import { parseCatalog } from '../news/catalog.ts'
import { NewsService } from '../news/news-service.ts'
import { DatabaseSync } from 'node:sqlite'
import {
  OUTDATED_API,
  PLUGIN_API,
  SIGNED_ONLY,
  checkSettings,
  parseManifest,
  settingValues
} from '../plugins/manifest.ts'
import { PluginInstaller, type Staged } from '../plugins/installer.ts'
import { TRUSTED_KEYS, packageDigest, unpackPackage } from '../plugins/package.ts'
import { ioBudget } from '../plugins/io-budget.ts'
import { zipLimits } from '../plugins/plugin-zip.ts'
import { MAX_READ_BYTES } from '../plugins/sandbox/protocol.ts'
import { type PluginRegistry, loadPlugins } from '../plugins/registry.ts'
import { MAX_HTTP_BODY } from '../plugins/sandbox-requests.ts'
import { fakeFetch } from './helpers/news.ts'

const ADMIN_PASSWORD = 'une phrase de passe assez longue'

const MANIFEST = {
  id: 'hello',
  name: 'Bonjour',
  version: '0.1.0',
  description: 'Dit bonjour.',
  api: PLUGIN_API,
  audience: 'all',
  provides: ['speech'],
  menu: { group: 'household', after: 'household', icon: 'Hand' },
  settings: [
    { key: 'greeting', type: 'text', default: 'Bonjour', maxLength: 20 },
    { key: 'loud', type: 'boolean', default: false },
    { key: 'times', type: 'number', default: 1, min: 1, max: 3 },
    { key: 'tone', type: 'choice', default: 'warm', options: ['warm', 'dry'] }
  ]
}

// A plugin as an install would hold it: its folder, its plugin.json and its server part.
const writePlugin = (dir: string, folder: string, manifest: unknown, server?: string) => {
  const root = path.join(dir, folder)
  mkdirSync(root, { recursive: true })
  writeFileSync(path.join(root, 'plugin.json'), JSON.stringify(manifest))
  if (server !== undefined) writeFileSync(path.join(root, 'server.js'), server)
}

const HELLO_SERVER = `
export default {
  migrations: [
    'CREATE TABLE visits (at INTEGER NOT NULL)',
    'ALTER TABLE visits ADD COLUMN name TEXT',
    'CREATE TABLE captures (id INTEGER PRIMARY KEY, data BLOB)'
  ],
  routes: {
    'GET /greeting': async (request, ctx) => {
      ctx.db.run('INSERT INTO visits (at) VALUES (?)', [Date.now()])
      const { greeting, times } = ctx.settings()
      return { body: { text: Array(times).fill(greeting).join(' ') } }
    },
    'GET /echo/:id': async request => ({
      status: 201,
      body: { params: request.params, query: request.query, who: request.who, keys: Object.keys(request).sort() },
      headers: { 'Cache-Control': 'private, max-age=60', 'Set-Cookie': 'hodi_session=forged' }
    }),
    'GET /redirect': async () => ({ status: 302, body: null }),
    'GET /spin': async () => { for (;;) {} },
    'GET /throw': async () => { throw new Error('oops') },
    'GET /not-an-answer': async () => 42,
    'PUT /capture': {
      raw: true,
      maxBody: 64,
      handler: async (request, ctx) => {
        if (request.body[0] !== 0x89 || request.body[1] !== 0x50) return { status: 400, body: { error: 'not_png' } }
        const { lastInsertRowid } = ctx.db.run('INSERT INTO captures (data) VALUES (?)', [request.body])
        return { status: 201, body: { id: lastInsertRowid, size: request.body.length } }
      }
    },
    'GET /pack': async request => ({
      zip: {
        filename: request.query.name ?? 'hodi-diagnostic-2026-11-08',
        entries: [
          { path: 'report.json', text: JSON.stringify({ ok: true }) },
          { path: 'captures/1.png', blob: { sql: 'SELECT data FROM captures WHERE id = ?', params: [1] } }
        ]
      }
    }),
    'GET /big-pack': async (_request, ctx) => {
      ctx.db.run('INSERT OR IGNORE INTO captures (id, data) VALUES (1000, zeroblob(6000000))')
      const blob = { sql: 'SELECT data FROM captures WHERE id = 1000' }
      return { zip: { filename: 'big', entries: ['a', 'b', 'c', 'd'].map(name => ({ path: name + '.bin', blob })) } }
    },
    'GET /bad-pack': async () => ({ zip: { filename: 'x', entries: [{ path: '../escape.txt', text: 'no' }] } }),
    'GET /lost-pack': async () => ({
      zip: { filename: 'x', entries: [{ path: 'a.png', blob: { sql: 'SELECT data FROM captures WHERE id = 99' } }] }
    })
  }
}
`

// A key the routes' plugins are signed with: only a signed plugin's web part is served.
const testKey = generateKeyPairSync('ed25519')
const TEST_TRUSTED = [testKey.publicKey.export({ type: 'spki', format: 'pem' }).toString()]
const signFolder = (root: string) =>
  writeFileSync(path.join(root, 'signature'), sign(null, packageDigest(root), testKey.privateKey).toString('base64'))

// Every plugin's thread, ended once the suite is done.
const registries: PluginRegistry[] = []
after(async () => {
  await Promise.all(registries.map(registry => registry.stop()))
})
const load = async (options: Parameters<typeof loadPlugins>[0]) => {
  const registry = await loadPlugins(options)
  registries.push(registry)
  return registry
}

describe('plugin manifest', () => {
  it('reads a complete manifest', () => {
    const manifest = parseManifest(MANIFEST)
    assert.equal(manifest.id, 'hello')
    assert.deepEqual(manifest.provides, ['speech'])
    assert.deepEqual(manifest.menu, { group: 'household', after: 'household', icon: 'Hand' })
    assert.equal(manifest.settings.length, 4)
  })

  it('fills in an audience for everyone and nothing provided', () => {
    const { audience, provides, menu, settings } = parseManifest({
      id: 'hello',
      name: 'Bonjour',
      version: '1.0.0',
      description: 'Dit bonjour.',
      api: PLUGIN_API
    })
    assert.equal(audience, 'all')
    assert.deepEqual(provides, [])
    assert.equal(menu, null)
    assert.deepEqual(settings, [])
  })

  it('reads what a plugin may ask of Hodi', () => {
    const manifest = parseManifest({
      ...MANIFEST,
      permissions: {
        network: ['news.example', 'news.example'],
        articles: true,
        publicRoutes: true,
        accounts: true,
        mail: true,
        signIn: true,
        households: true,
        notify: true,
        ai: true
      },
      memoryMb: 32
    })
    assert.deepEqual(manifest.permissions, {
      network: ['news.example'],
      articles: true,
      publicRoutes: true,
      accounts: true,
      mail: true,
      signIn: true,
      households: true,
      notify: true,
      ai: true
    })
    assert.equal(manifest.memoryMb, 32)
    assert.deepEqual(parseManifest(MANIFEST).permissions, {
      network: [],
      articles: false,
      publicRoutes: false,
      accounts: false,
      mail: false,
      signIn: false,
      households: false,
      notify: false,
      ai: false
    })
  })

  it('tells a plugin written for API 1 apart', () => {
    assert.throws(() => parseManifest({ ...MANIFEST, api: 1 }), new RegExp(OUTDATED_API))
  })

  it('refuses what Hodi could not use safely', () => {
    const refused = [
      { ...MANIFEST, permissions: { network: ['http://news.example'] } },
      { ...MANIFEST, permissions: { network: ['localhost'] } },
      { ...MANIFEST, permissions: { network: 'news.example' } },
      { ...MANIFEST, permissions: { articles: 'yes' } },
      { ...MANIFEST, permissions: { publicRoutes: 'yes' } },
      { ...MANIFEST, permissions: { accounts: 'yes' } },
      { ...MANIFEST, permissions: { mail: 'yes' } },
      { ...MANIFEST, permissions: { signIn: 'yes' } },
      { ...MANIFEST, permissions: { households: 'yes' } },
      { ...MANIFEST, memoryMb: 0 },
      { ...MANIFEST, memoryMb: 1.5 },
      { ...MANIFEST, memoryMb: 33 },
      { ...MANIFEST, id: '../hello' },
      { ...MANIFEST, id: 'Hello' },
      { ...MANIFEST, version: 'latest' },
      { ...MANIFEST, api: PLUGIN_API + 1 },
      { ...MANIFEST, audience: 'teen' },
      { ...MANIFEST, provides: ['root'] },
      { ...MANIFEST, name: '' },
      { ...MANIFEST, menu: { group: 'household', icon: '<svg>' } },
      { ...MANIFEST, settings: [{ key: 'loud', type: 'boolean', default: 'yes' }] },
      { ...MANIFEST, settings: [{ key: 'times', type: 'number', default: 9, max: 3 }] },
      { ...MANIFEST, settings: [{ key: 'tone', type: 'choice', default: 'cold', options: ['warm'] }] },
      {
        ...MANIFEST,
        settings: [
          { key: 'loud', type: 'boolean', default: true },
          { key: 'loud', type: 'boolean', default: false }
        ]
      }
    ]
    for (const manifest of refused) assert.throws(() => parseManifest(manifest), JSON.stringify(manifest))
  })

  it('keeps stored settings that still fit, and the defaults for the rest', () => {
    const { settings } = parseManifest(MANIFEST)
    assert.deepEqual(settingValues(settings, { greeting: 'Salut', times: 9, tone: 'dry', gone: 1 }), {
      greeting: 'Salut',
      loud: false,
      times: 1,
      tone: 'dry'
    })
  })

  it('accepts only declared settings that fit their type', () => {
    const { settings } = parseManifest(MANIFEST)
    assert.deepEqual(checkSettings(settings, { loud: true, times: 2 }), { loud: true, times: 2 })
    assert.equal(checkSettings(settings, { loud: 'yes' }), null)
    assert.equal(checkSettings(settings, { times: 4 }), null)
    assert.equal(checkSettings(settings, { greeting: 'x'.repeat(21) }), null)
    assert.equal(checkSettings(settings, { other: 1 }), null)
    assert.equal(checkSettings(settings, ['loud']), null)
  })
})

describe('plugin registry', () => {
  it('refuses a public route that asks for a password: nobody signed in asks it', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'hodi-plugins-'))
    writePlugin(
      dir,
      'hello',
      MANIFEST,
      `export default { publicRoutes: { 'POST /x': { proof: true, handler: async () => ({}) } } }`
    )
    const db = openDatabase(':memory:')
    const dataDir = mkdtempSync(path.join(tmpdir(), 'hodi-plugin-data-'))
    const plugins = await load({ dir, dataDir, store: new PluginStore(db), log: () => {} })
    try {
      assert.match(plugins.get('hello')!.error!, /POST \/x: a public route cannot ask for a password/)
    } finally {
      await plugins.stop()
      rmSync(dir, { recursive: true, force: true })
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('loads plugins, runs their migrations once and lists a broken one with its error', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'hodi-plugins-'))
    writePlugin(dir, 'hello', MANIFEST, HELLO_SERVER)
    writePlugin(dir, 'misnamed', MANIFEST)
    writePlugin(dir, 'future', { ...MANIFEST, id: 'future', api: PLUGIN_API + 1 })
    writePlugin(dir, 'crash', { ...MANIFEST, id: 'crash' }, 'throw new Error("boom")\nexport default {}')
    writePlugin(dir, 'old', { ...MANIFEST, id: 'old', api: 1 }, 'export default {}')
    writePlugin(
      dir,
      'bad-route',
      { ...MANIFEST, id: 'bad-route' },
      `export default { routes: { 'GET greeting': async () => ({}) } }`
    )
    writePlugin(dir, 'web-only', { ...MANIFEST, id: 'web-only', provides: [] })
    const db = openDatabase(':memory:')
    const store = new PluginStore(db)
    const dataDir = mkdtempSync(path.join(tmpdir(), 'hodi-plugin-data-'))
    const logs: string[] = []
    const start = () => load({ dir, dataDir, store, log: line => logs.push(line) })

    const plugins = await start()
    assert.deepEqual(
      plugins.list().map(plugin => [plugin.id, plugin.error === null]),
      [
        ['bad-route', false],
        ['crash', false],
        ['future', false],
        ['hello', true],
        ['misnamed', false],
        ['old', false],
        ['web-only', true]
      ]
    )
    assert.match(plugins.get('crash')!.error!, /boom/)
    assert.match(plugins.get('misnamed')!.error!, /folder must be named hello/)
    assert.match(plugins.get('bad-route')!.error!, /GET greeting is not a route/)
    assert.equal(plugins.get('old')!.error, OUTDATED_API)
    // Listed by its name, to be updated.
    assert.equal(plugins.get('old')!.manifest?.name, 'Bonjour')
    assert.equal(plugins.enabled('old'), false)
    assert.equal(plugins.enabled('hello'), true)
    assert.equal(plugins.enabled('crash'), false)
    assert.equal(plugins.enabled('web-only'), true)
    assert.equal(logs.length, 5)
    assert.deepEqual(plugins.get('hello')!.shape?.routes.slice(0, 2), ['GET /greeting', 'GET /echo/:id'])

    // Its steps ran in its own database, and a second start runs none again.
    await plugins.stop()
    await start()
    const own = new DatabaseSync(path.join(dataDir, 'hello', 'plugin.db'))
    assert.deepEqual(
      own
        .prepare('SELECT step FROM hodi_migrations ORDER BY step')
        .all()
        .map(row => ({ ...row })),
      [{ step: 0 }, { step: 1 }, { step: 2 }]
    )
    own.close()
  })

  it('tells whether an active plugin brings a capability', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'hodi-plugins-'))
    writePlugin(dir, 'hello', MANIFEST)
    const db = openDatabase(':memory:')
    const store = new PluginStore(db)
    const plugins = await load({ dir, dataDir: mkdtempSync(path.join(tmpdir(), 'hodi-plugin-data-')), store })

    assert.equal(plugins.provides('speech'), true)
    assert.equal(plugins.provides('profile-kind:child'), false)
    store.setEnabled('hello', false)
    assert.equal(plugins.provides('speech'), false)
  })

  it('tells the active plugins of an article read, and gives them the articles', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'hodi-plugins-'))
    const listener = `
      export default {
        migrations: ['CREATE TABLE heard (id TEXT, article TEXT, status TEXT)'],
        onArticle: async (article, ctx) => {
          const read = await ctx.articles.get(article.id)
          ctx.db.run('INSERT INTO heard VALUES (?, ?, ?)', [ctx.id, article.id, read.status])
        },
        routes: { 'GET /heard': async (request, ctx) => ({ body: ctx.db.query('SELECT * FROM heard') }) }
      }`
    const allowed = { ...MANIFEST, permissions: { articles: true } }
    writePlugin(dir, 'listener', { ...allowed, id: 'listener' }, listener)
    writePlugin(dir, 'off', { ...allowed, id: 'off' }, listener)
    // Without the permission, ctx.articles is refused.
    writePlugin(dir, 'nosy', { ...MANIFEST, id: 'nosy' }, listener)
    writePlugin(
      dir,
      'clumsy',
      { ...MANIFEST, id: 'clumsy' },
      `export default { onArticle: async () => { throw new Error('oops') } }`
    )
    const db = openDatabase(':memory:')
    const store = new PluginStore(db)
    const article = {
      id: 'a1',
      title: 'Pluie',
      url: 'https://alpha.example/pluie',
      sourceId: 'alpha',
      sourceName: 'Alpha',
      publishedAt: null,
      status: 'ok' as const,
      text: { title: 'Pluie', byline: null, contentHtml: '<p>Pluie</p>', textLength: 5 }
    }
    const lines: string[] = []
    const plugins = await load({
      dir,
      dataDir: mkdtempSync(path.join(tmpdir(), 'hodi-plugin-data-')),
      store,
      articles: { get: async id => (id === 'a1' ? article : null), page: async () => null },
      log: line => lines.push(line)
    })
    store.setEnabled('off', false)

    plugins.tellArticle(article)
    // A plugin's calls run one after another: its route answers once its hook is done.
    const heard = async (id: string) => plugins.get(id)!.sandbox!.call('routes', 'GET /heard', null)
    // Once, by the plugin that is on; the one that throws is logged, and the others still hear.
    assert.deepEqual(await heard('listener'), { body: [{ id: 'listener', article: 'a1', status: 'ok' }] })
    assert.deepEqual(await heard('off'), { body: [] })
    assert.deepEqual(await heard('nosy'), { body: [] })
    for (let tries = 0; tries < 50 && lines.filter(line => line.includes('onArticle failed')).length < 2; tries++) {
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert.ok(lines.some(line => line.includes('[plugin clumsy] onArticle failed: plugin_error: oops')))
    assert.ok(lines.some(line => line.includes('[plugin nosy] onArticle failed: plugin_error: not_allowed')))
  })

  it("lets ctx.fetchText reach only the sites a plugin's manifest lists", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'hodi-plugins-'))
    const fetcher = `export default { routes: { 'GET /fetch': async (request, ctx) => {
      const tries = ['https://allowed.test/', 'https://exfil.test/?data=secret', 'https://allowed.test/redirect']
      return { body: await Promise.all(tries.map(url => ctx.fetchText(url).then(got => got.url, error => error.message))) }
    }, 'GET /headers': async (request, ctx) => (await ctx.fetchText('https://allowed.test/headers', {
      headers: { 'Accept-Language': 'fr', 'If-None-Match': '"v1"', Cookie: 'session=stolen', Authorization: 'x', Host: 'evil.test' }
    })).text } }`
    writePlugin(dir, 'fetcher', { ...MANIFEST, id: 'fetcher', permissions: { network: ['allowed.test'] } }, fetcher)
    writePlugin(dir, 'offline', { ...MANIFEST, id: 'offline' }, fetcher)
    const plugins = await load({
      dir,
      dataDir: mkdtempSync(path.join(tmpdir(), 'hodi-plugin-data-')),
      store: new PluginStore(openDatabase(':memory:')),
      isPublicUrl: async () => true,
      // As fetch-text.ts does: every hop of a redirect is checked before it leaves.
      fetchTextFor: isAllowed => async (url, options) => {
        if (url.endsWith('/headers')) return { url, text: JSON.stringify(options?.headers ?? {}) }
        const hops = url.endsWith('/redirect') ? [url, 'https://exfil.test/'] : [url]
        for (const hop of hops) if (!(await isAllowed(new URL(hop)))) throw new Error(`Blocked address: ${hop}`)
        return { url: hops.at(-1)!, text: 'page' }
      }
    })
    assert.deepEqual(await plugins.get('fetcher')!.sandbox!.call('routes', 'GET /fetch', null), {
      body: [
        'https://allowed.test/',
        'Blocked address: https://exfil.test/?data=secret',
        'Blocked address: https://exfil.test/'
      ]
    })
    assert.deepEqual(await plugins.get('offline')!.sandbox!.call('routes', 'GET /fetch', null), {
      body: ['not_allowed', 'not_allowed', 'not_allowed']
    })
    // Only a few harmless headers go through.
    assert.deepEqual(JSON.parse(String(await plugins.get('fetcher')!.sandbox!.call('routes', 'GET /headers', null))), {
      'Accept-Language': 'fr',
      'If-None-Match': '"v1"'
    })
  })

  it('lets ctx.http send a request to the listed sites only, with a body and a token over https only', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'hodi-plugins-'))
    const caller = `export default { routes: { 'POST /try': async (request, ctx) => {
      const tries = request.body.map(([url, options]) => ctx.http(url, options).then(got => got, error => error.message))
      return { body: await Promise.all(tries) }
    } } }`
    writePlugin(dir, 'caller', { ...MANIFEST, id: 'caller', permissions: { network: ['oauth.test'] } }, caller)
    writePlugin(dir, 'offline', { ...MANIFEST, id: 'offline' }, caller)
    const sent: unknown[] = []
    const plugins = await load({
      dir,
      dataDir: mkdtempSync(path.join(tmpdir(), 'hodi-plugin-data-')),
      store: new PluginStore(openDatabase(':memory:')),
      isPublicUrl: async () => true,
      fetchHttpFor: isAllowed => async (url, options) => {
        if (!(await isAllowed(new URL(url)))) throw new Error(`Blocked address: ${url}`)
        sent.push({ url, ...options })
        return { url, status: 400, contentType: 'application/json', text: '{"error":"invalid_grant"}' }
      }
    })
    const tries = [
      [
        'https://oauth.test/token',
        {
          method: 'POST',
          form: { code: 'abc', grant_type: 'authorization_code' },
          headers: {
            Authorization: 'Basic eA==',
            Cookie: 'session=stolen',
            Host: 'evil.test',
            Accept: 'application/json'
          }
        }
      ],
      ['https://oauth.test/me', { headers: { authorization: 'Bearer t' } }],
      ['https://oauth.test/json', { method: 'PUT', json: { a: 1 } }],
      ['https://exfil.test/', { method: 'POST', body: 'secret' }],
      ['http://oauth.test/token', { method: 'POST', body: 'secret' }],
      ['http://oauth.test/me', { headers: { Authorization: 'Bearer t' } }],
      ['https://oauth.test/', { body: 'a' }],
      ['https://oauth.test/', { method: 'POST', body: 'a', json: {} }],
      ['https://oauth.test/', { method: 'TRACE' }],
      ['https://oauth.test/', { method: 'POST', body: 'x'.repeat(MAX_HTTP_BODY + 1) }],
      ['https://oauth.test/', { method: 'POST', form: { a: 1 } }]
    ]
    const answer = { url: '', status: 400, contentType: 'application/json', text: '{"error":"invalid_grant"}' }
    assert.deepEqual(await plugins.get('caller')!.sandbox!.call('routes', 'POST /try', { body: tries }), {
      body: [
        { ...answer, url: 'https://oauth.test/token' },
        { ...answer, url: 'https://oauth.test/me' },
        { ...answer, url: 'https://oauth.test/json' },
        'Blocked address: https://exfil.test/',
        'https_only',
        'https_only',
        'get_has_no_body',
        'one_body',
        'invalid_method',
        'body_too_large',
        'invalid_form'
      ]
    })
    // Only the headers a plugin may set go out; Hodi writes the content type of a form or JSON.
    assert.deepEqual(sent, [
      {
        url: 'https://oauth.test/token',
        method: 'POST',
        headers: {
          Authorization: 'Basic eA==',
          Accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded'
        },
        body: 'code=abc&grant_type=authorization_code'
      },
      { url: 'https://oauth.test/me', method: 'GET', headers: { authorization: 'Bearer t' }, body: undefined },
      {
        url: 'https://oauth.test/json',
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: '{"a":1}'
      }
    ])
    assert.deepEqual(await plugins.get('offline')!.sandbox!.call('routes', 'POST /try', { body: tries.slice(0, 1) }), {
      body: ['not_allowed']
    })
  })

  it('reads nothing when the folder does not exist yet', async () => {
    const db = openDatabase(':memory:')
    const plugins = await load({
      dir: path.join(tmpdir(), 'hodi-no-plugins-here'),
      dataDir: tmpdir(),
      store: new PluginStore(db)
    })
    assert.deepEqual(plugins.list(), [])
  })
})

describe('plugin routes', () => {
  let baseUrl: string
  let close: () => void
  let plugins: PluginRegistry
  let adminCookie = ''
  let memberCookie = ''
  let restarts = 0
  let pluginDir = ''
  const db = openDatabase(':memory:')
  const household = new HouseholdStore(db)
  const profiles = new ProfileStore(db)

  const call = (url: string, cookie: string, method = 'GET', body?: unknown) =>
    fetch(`${baseUrl}/api${url}`, {
      method,
      headers: { cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body)
    })

  const cookiesFrom = (response: Response) =>
    response.headers
      .getSetCookie()
      .map(cookie => cookie.split(';')[0])
      .join('; ')

  before(async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'hodi-plugins-'))
    pluginDir = dir
    writePlugin(dir, 'hello', MANIFEST, HELLO_SERVER)
    writePlugin(
      dir,
      'secret',
      { ...MANIFEST, id: 'secret', audience: 'admin', settings: [] },
      `export default {
        routes: { 'GET /ping': async () => ({ body: { pong: true } }) },
        serverRoutes: { 'POST /waitlist': async request => ({ body: { got: request.body } }) }
      }`
    )
    writePlugin(dir, 'broken', { ...MANIFEST, id: 'broken' }, 'export default 42')
    // What the browser asks for.
    mkdirSync(path.join(dir, 'hello', 'locales'))
    mkdirSync(path.join(dir, 'hello', 'assets', 'island'), { recursive: true })
    writeFileSync(path.join(dir, 'hello', 'web.js'), 'window.__hodi.sdk.definePlugin({})')
    writeFileSync(path.join(dir, 'hello', 'locales', 'fr.json'), '{"hello":"Bonjour"}')
    writeFileSync(
      path.join(dir, 'hello', 'locales', 'en.json'),
      '{"hello":"Hello","manifest":{"name":"Hello","description":"Says hello."}}'
    )
    writeFileSync(path.join(dir, 'hello', 'locales', 'notes.txt'), 'not a locale')
    writeFileSync(path.join(dir, 'hello', 'assets', 'island', 'map.png'), 'png')
    writeFileSync(path.join(dir, 'hello', 'assets', '.hidden'), 'secret')
    writeFileSync(path.join(dir, 'secret', 'web.js'), '// admin only')
    signFolder(path.join(dir, 'hello'))
    signFolder(path.join(dir, 'secret'))
    // Nobody signed this one: it runs, but its web part never reaches the page.
    writePlugin(dir, 'loose', { ...MANIFEST, id: 'loose', audience: 'admin', settings: [] }, HELLO_SERVER)
    writeFileSync(path.join(dir, 'loose', 'web.js'), 'window.stolen = document.cookie')
    mkdirSync(path.join(dir, 'loose', 'locales'))
    writeFileSync(path.join(dir, 'loose', 'locales', 'fr.json'), '{"settings":{"greeting":"Salutation"}}')
    plugins = await load({
      dir,
      dataDir: mkdtempSync(path.join(tmpdir(), 'hodi-plugin-data-')),
      store: new PluginStore(db),
      trustedKeys: TEST_TRUSTED,
      timeoutMs: 1_000,
      log: () => {}
    })

    const webDir = mkdtempSync(path.join(tmpdir(), 'hodi-web-'))
    writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>Hodi</title>')
    const config: Config = {
      host: '127.0.0.1',
      port: 0,
      sessionSecret: Buffer.alloc(32, 3),
      webDir,
      sourcesFile: 'unused.yml',
      databaseFile: ':memory:',
      backupDir: 'unused-backups',
      timeZone: 'UTC',
      vapid: { publicKey: 'unused', privateKey: 'unused', subject: 'mailto:test@example.com' }
    }
    const catalog = parseCatalog('topics:\n  - id: monde\n    label: Monde\n    sources: []\n')
    const accounts = new UserAccountStore(db)
    const server = createApp(config, {
      news: new NewsService(catalog, { fetchText: fakeFetch({}).fetchText, log: () => {} }),
      profiles,
      household,
      accounts,
      devices: new UserDeviceStore(db),
      plugins,
      pluginInstaller: {
        installer: new PluginInstaller({ dir, installedVersion: id => plugins.get(id)?.manifest?.version ?? null }),
        restart: () => {
          restarts += 1
        }
      }
    }).listen(0)
    await new Promise(resolve => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    close = () => server.close()

    // The server admin's account, the household with its profile, and a second adult who is not the admin.
    const account = await fetch(`${baseUrl}/api/setup/account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'antho@example.com', password: ADMIN_PASSWORD })
    })
    assert.equal(account.status, 204)
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
    adminCookie = `${session}; ${cookiesFrom(setup)}`
    const created = await call('/profiles', adminCookie, 'POST', { name: 'Sam', color: 'monde', kind: 'adult' })
    assert.equal(created.status, 201)
    const { id } = (await created.json()) as { id: number }
    // Sam's own account: every adult profile opens with its account's password.
    const sam = accounts.create(
      'sam@example.com',
      await hashPassword('la phrase de Sam', { N: 2 ** 10, r: 8, p: 1 }),
      0
    )!
    accounts.linkProfile(sam.id, id)
    const chosen = await call('/profiles/current', adminCookie, 'PUT', { id, password: 'la phrase de Sam' })
    assert.equal(chosen.status, 200)
    memberCookie = `${adminCookie.split('; ').find(cookie => !cookie.startsWith('hodi_profile'))}; ${cookiesFrom(chosen)}`
  })

  after(() => close())

  it('serves what a plugin brings to the web app, and nothing else', async () => {
    const listed = (await (await call('/plugins', memberCookie)).json()) as {
      plugins: { web: unknown; translations: unknown }[]
    }
    // Its name and description in English, from its locales: plugin.json keeps the French ones.
    assert.deepEqual(listed.plugins[0].translations, { en: { name: 'Hello', description: 'Says hello.' } })
    assert.deepEqual(listed.plugins[0].web, {
      script: true,
      style: false,
      publicScript: false,
      publicStyle: false,
      locales: ['en', 'fr']
    })

    const script = await call('/plugins/hello/files/web.js?v=1.0.0', memberCookie)
    assert.equal(script.status, 200)
    assert.match(script.headers.get('content-type') ?? '', /javascript/)
    assert.equal(script.headers.get('cache-control'), 'no-cache')
    assert.equal(await script.text(), 'window.__hodi.sdk.definePlugin({})')
    assert.deepEqual(await (await call('/plugins/hello/files/locales/en.json', memberCookie)).json(), {
      hello: 'Hello',
      manifest: { name: 'Hello', description: 'Says hello.' }
    })
    assert.equal((await call('/plugins/hello/files/assets/island/map.png', memberCookie)).status, 200)

    // Its server code and manifest, other files, hidden ones and paths that climb out are never served.
    for (const file of [
      'server.js',
      'plugin.json',
      'web.css',
      'locales/notes.txt',
      'assets/.hidden',
      'assets/../server.js',
      'assets/%2e%2e/server.js',
      '..%2fplugin.json'
    ]) {
      assert.equal((await call(`/plugins/hello/files/${file}`, memberCookie)).status, 404, file)
    }
    // The same gate as its routes.
    assert.equal((await call('/plugins/secret/files/web.js', memberCookie)).status, 403)
    assert.equal((await call('/plugins/secret/files/web.js', adminCookie)).status, 200)
    assert.equal((await call('/plugins/hello/files/web.js', '')).status, 401)
  })

  it('never serves the web part of a plugin nobody signed, and still runs its routes', async () => {
    const listed = (await (await call('/plugins', adminCookie)).json()) as {
      plugins: { id: string; signed: boolean; web: unknown }[]
    }
    const loose = listed.plugins.find(plugin => plugin.id === 'loose')
    assert.deepEqual(
      [loose?.signed, loose?.web],
      [false, { script: false, style: false, publicScript: false, publicStyle: false, locales: ['fr'] }]
    )
    assert.equal(listed.plugins.find(plugin => plugin.id === 'hello')?.signed, true)
    for (const cookie of [memberCookie, adminCookie]) {
      assert.equal((await call('/plugins/loose/files/web.js', cookie)).status, 404)
    }
    assert.equal((await call('/plugins/loose/greeting', adminCookie)).status, 200)
  })

  it('serves the texts of a plugin nobody signed, so its options are named, and nothing else of it', async () => {
    const texts = await call('/plugins/loose/files/locales/fr.json', adminCookie)
    assert.equal(texts.status, 200)
    assert.deepEqual(await texts.json(), { settings: { greeting: 'Salutation' } })
    // Its audience still holds: an admin-only plugin's texts are the admin's.
    assert.equal((await call('/plugins/loose/files/locales/fr.json', memberCookie)).status, 403)
    assert.equal((await call('/plugins/loose/files/locales/en.json', adminCookie)).status, 404)
    for (const file of ['web.js', 'web.css', 'web-public.js', 'assets/page.html', 'server.js', 'plugin.json'])
      assert.equal((await call(`/plugins/loose/files/${file}`, adminCookie)).status, 404, file)
  })

  it('needs a session', async () => {
    assert.equal((await call('/plugins', '')).status, 401)
    assert.equal((await call('/plugins/hello/greeting', '')).status, 401)
  })

  it('lists every plugin to the admin, and only the active ones meant for them to others', async () => {
    const admin = (await (await call('/plugins', adminCookie)).json()) as { plugins: { id: string }[] }
    assert.deepEqual(
      admin.plugins.map(plugin => plugin.id),
      ['broken', 'hello', 'loose', 'secret']
    )
    const member = (await (await call('/plugins', memberCookie)).json()) as {
      plugins: { id: string; values: unknown; enabled: boolean }[]
    }
    assert.deepEqual(
      member.plugins.map(plugin => plugin.id),
      ['hello']
    )
    assert.deepEqual(member.plugins[0].values, { greeting: 'Bonjour', loud: false, times: 1, tone: 'warm' })
  })

  it('serves a plugin route to the profiles it is meant for', async () => {
    assert.deepEqual(await (await call('/plugins/hello/greeting', memberCookie)).json(), { text: 'Bonjour' })
    assert.equal((await call('/plugins/secret/ping', adminCookie)).status, 200)
    assert.equal((await call('/plugins/secret/ping', memberCookie)).status, 403)
    assert.equal((await call('/plugins/broken/anything', adminCookie)).status, 404)
  })

  it('gives a plugin a clean request, and writes its answer itself', async () => {
    const answered = await call('/plugins/hello/echo/12?page=2&page=3&q=pluie', memberCookie)
    assert.equal(answered.status, 201)
    const { params, query, who, keys } = (await answered.json()) as Record<string, unknown>
    assert.deepEqual(params, { id: '12' })
    // A query part given twice is not passed on.
    assert.deepEqual(query, { q: 'pluie' })
    // The device is signed in with the admin's account (1), and Sam's profile is open on it.
    assert.deepEqual(who, {
      profileId: 2,
      householdId: 1,
      kind: 'adult',
      householdAdmin: false,
      serverAdmin: false,
      accountId: 1
    })
    // No cookie, no header, no session.
    assert.deepEqual(keys, ['body', 'method', 'params', 'path', 'query', 'who'])
    assert.equal(answered.headers.get('cache-control'), 'private, max-age=60')
    assert.equal(answered.headers.get('set-cookie'), null)
    assert.equal(answered.headers.get('x-content-type-options'), 'nosniff')
    assert.match(answered.headers.get('content-type') ?? '', /application\/json/)
  })

  it("keeps another site's links and forms away from a plugin's routes", async () => {
    const from = async (site: string) =>
      (
        await fetch(`${baseUrl}/api/plugins/hello/greeting`, {
          headers: { cookie: memberCookie, 'Sec-Fetch-Site': site }
        })
      ).status
    assert.equal(await from('cross-site'), 403)
    assert.equal(await from('same-site'), 403)
    assert.equal(await from('same-origin'), 200)
    // The person typing the address, or opening a bookmark.
    assert.equal(await from('none'), 200)
  })

  it('takes a raw body on the routes that ask for one, counting its bytes', async () => {
    const put = (body: Uint8Array, type = 'image/png') =>
      fetch(`${baseUrl}/api/plugins/hello/capture`, {
        method: 'PUT',
        headers: { cookie: memberCookie, 'Content-Type': type },
        body
      })
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7])
    const stored = await put(png)
    assert.equal(stored.status, 201)
    assert.deepEqual(await stored.json(), { id: 1, size: 10 })
    assert.equal((await put(new Uint8Array([1, 2, 3]))).status, 400)
    assert.equal((await put(new Uint8Array(65))).status, 413)
    assert.equal((await put(png, 'image/svg+xml')).status, 415)
    assert.equal((await put(png, 'text/html')).status, 415)
  })

  it('builds the zip a plugin lists, its files read from the plugin database by Hodi', async () => {
    const answer = await call('/plugins/hello/pack?name=../../evil"\r\nSet-Cookie: x', memberCookie)
    assert.equal(answer.status, 200)
    assert.equal(answer.headers.get('content-type'), 'application/zip')
    assert.equal(answer.headers.get('content-disposition'), 'attachment; filename="evil-Set-Cookie-x.zip"')
    assert.equal(answer.headers.get('set-cookie'), null)
    assert.equal(answer.headers.get('x-content-type-options'), 'nosniff')
    const files = unzipSync(new Uint8Array(await answer.arrayBuffer()))
    assert.deepEqual(Object.keys(files).sort(), ['captures/1.png', 'report.json'])
    assert.deepEqual(JSON.parse(new TextDecoder().decode(files['report.json'])), { ok: true })
    assert.deepEqual([...files['captures/1.png']!], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7])
    const named = await call('/plugins/hello/pack', memberCookie)
    assert.equal(named.headers.get('content-disposition'), 'attachment; filename="hodi-diagnostic-2026-11-08.zip"')
    await named.arrayBuffer()
    // A path out of the archive is refused before anything is sent; a file the plugin cannot find ends the download.
    assert.equal((await call('/plugins/hello/bad-pack', memberCookie)).status, 502)
    await assert.rejects(async () => (await call('/plugins/hello/lost-pack', memberCookie)).arrayBuffer())
  })

  it('refuses a raw body at once when Hodi has no room left to hold it', async () => {
    const saved = ioBudget.bytes
    // Room for one 60-byte body and its copy.
    ioBudget.bytes = 120
    try {
      const { port } = new URL(baseUrl)
      // The first upload announces 60 bytes and sends them slowly.
      const first = new Promise<number>((resolve, reject) => {
        const request = httpRequest(
          {
            host: '127.0.0.1',
            port,
            path: '/api/plugins/hello/capture',
            method: 'PUT',
            headers: { cookie: memberCookie, 'Content-Type': 'image/png', 'Content-Length': 60 }
          },
          response => {
            response.resume()
            resolve(response.statusCode ?? 0)
          }
        )
        request.on('error', reject)
        request.write(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0]))
        setTimeout(() => request.end(Buffer.alloc(50)), 300)
      })
      await new Promise(resolve => setTimeout(resolve, 100))
      const second = await fetch(`${baseUrl}/api/plugins/hello/capture`, {
        method: 'PUT',
        headers: { cookie: memberCookie, 'Content-Type': 'image/png' },
        body: new Uint8Array([0x89, 0x50, 0x4e, 0x47])
      })
      assert.equal(second.status, 503)
      assert.equal(await first, 201)
      // Its room is free again.
      const third = await fetch(`${baseUrl}/api/plugins/hello/capture`, {
        method: 'PUT',
        headers: { cookie: memberCookie, 'Content-Type': 'image/png' },
        body: new Uint8Array([0x89, 0x50, 0x4e, 0x47])
      })
      assert.equal(third.status, 201)
    } finally {
      ioBudget.bytes = saved
    }
  })

  it('sends few zips at once, and drops a download its client stopped reading', async () => {
    const saved = { ...zipLimits }
    const savedBudget = ioBudget.bytes
    Object.assign(zipLimits, { running: 1, idleMs: 300 })
    // Room for one zip being sent, nothing more.
    ioBudget.bytes = MAX_READ_BYTES + zipLimits.sliceBytes
    try {
      const { port } = new URL(baseUrl)
      // A client that asks for the zip and never reads it.
      const stalled = httpRequest({
        host: '127.0.0.1',
        port,
        path: '/api/plugins/hello/big-pack',
        headers: { cookie: memberCookie }
      })
      stalled.on('response', response => response.pause())
      stalled.on('error', () => {})
      stalled.end()
      await new Promise(resolve => setTimeout(resolve, 150))
      // It takes the only place for a zip, and its room in the I/O budget: an upload finds none.
      assert.equal((await call('/plugins/hello/big-pack', memberCookie)).status, 503)
      const upload = () =>
        fetch(`${baseUrl}/api/plugins/hello/capture`, {
          method: 'PUT',
          headers: { cookie: memberCookie, 'Content-Type': 'image/png' },
          body: new Uint8Array([0x89, 0x50, 0x4e, 0x47])
        })
      assert.equal((await upload()).status, 503)
      // Past idleMs it is dropped, and its place is free again.
      await new Promise(resolve => setTimeout(resolve, 800))
      stalled.destroy()
      assert.equal((await upload()).status, 201)
      // Once it is gone, the next download gets the whole archive.
      Object.assign(zipLimits, { idleMs: 30_000 })
      const files = unzipSync(new Uint8Array(await (await call('/plugins/hello/big-pack', memberCookie)).arrayBuffer()))
      assert.deepEqual(
        Object.values(files).map(file => file.length),
        [6_000_000, 6_000_000, 6_000_000, 6_000_000]
      )
    } finally {
      Object.assign(zipLimits, saved)
      ioBudget.bytes = savedBudget
    }
  })

  it('answers for a plugin that fails, without saying more', async () => {
    const statusOf = async (route: string) => (await call(`/plugins/hello/${route}`, memberCookie)).status
    // No redirect goes through a plugin.
    assert.equal(await statusOf('redirect'), 502)
    assert.equal(await statusOf('throw'), 500)
    assert.equal(await statusOf('not-an-answer'), 502)
    assert.equal(await statusOf('spin'), 504)
    // Its thread starts again for the next call.
    assert.equal(await statusOf('greeting'), 200)
  })

  it("serves a plugin's routes for the server's space to the server admin only", async () => {
    const asked = await call('/server/plugins/secret/waitlist', adminCookie, 'POST', { name: 'Léa' })
    assert.equal(asked.status, 200)
    assert.deepEqual(await asked.json(), { got: { name: 'Léa' } })
    assert.equal((await call('/server/plugins/secret/waitlist', memberCookie, 'POST', {})).status, 403)
    assert.equal((await call('/server/plugins/secret/waitlist', '', 'POST', {})).status, 401)
    // A plugin without them, or a broken one, has none.
    assert.equal((await call('/server/plugins/hello/waitlist', adminCookie, 'POST', {})).status, 404)
    assert.equal((await call('/server/plugins/broken/waitlist', adminCookie, 'POST', {})).status, 404)
  })

  it("changes a plugin's settings and turns it off, for the server admin only", async () => {
    assert.equal((await call('/plugins/hello', memberCookie, 'PATCH', { enabled: false })).status, 403)
    // On the server admin's own device, another adult's profile is not the server admin.
    const asked = async (cookie: string) => (await (await call('/profiles', cookie)).json()) as { serverAdmin: boolean }
    assert.equal((await asked(adminCookie)).serverAdmin, true)
    assert.equal((await asked(memberCookie)).serverAdmin, false)
    assert.equal((await call('/plugins/hello', adminCookie, 'PATCH', { settings: { times: 7 } })).status, 400)
    assert.equal((await call('/plugins/hello', adminCookie, 'PATCH', { enabled: 'no' })).status, 400)
    assert.equal((await call('/plugins/nobody', adminCookie, 'PATCH', { enabled: false })).status, 404)

    const changed = await call('/plugins/hello', adminCookie, 'PATCH', { settings: { greeting: 'Salut', times: 2 } })
    assert.equal(changed.status, 200)
    assert.deepEqual(await (await call('/plugins/hello/greeting', memberCookie)).json(), { text: 'Salut Salut' })

    const off = await call('/plugins/hello', adminCookie, 'PATCH', { enabled: false })
    assert.equal(((await off.json()) as { enabled: boolean }).enabled, false)
    assert.equal((await call('/plugins/hello/greeting', memberCookie)).status, 404)
    const member = (await (await call('/plugins', memberCookie)).json()) as { plugins: unknown[] }
    assert.deepEqual(member.plugins, [])

    // Back on, with the settings it had.
    await call('/plugins/hello', adminCookie, 'PATCH', { enabled: true })
    assert.deepEqual(await (await call('/plugins/hello/greeting', memberCookie)).json(), { text: 'Salut Salut' })
  })

  it('installs a package in two steps, then removes it, restarting Hodi each time', async () => {
    const send = (cookie: string, bytes: Buffer) =>
      fetch(`${baseUrl}/api/plugins/packages`, {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(bytes)
      })
    const bytes = await makePackage({
      'plugin.json': JSON.stringify({ ...MANIFEST, id: 'other', permissions: { network: ['news.example'] } })
    })

    assert.equal((await send(memberCookie, bytes)).status, 403)
    assert.equal((await send(adminCookie, Buffer.from('nope'))).status, 400)

    const staged = await send(adminCookie, bytes)
    assert.equal(staged.status, 201)
    const { token, id, signed, replaces, permissions } = (await staged.json()) as {
      token: string
      id: string
      signed: boolean
      replaces: string | null
      permissions: unknown
    }
    assert.deepEqual([id, signed, replaces], ['other', false, null])
    // What the admin reads before saying yes: the permissions as Hodi will enforce them.
    assert.deepEqual(permissions, {
      network: ['news.example'],
      articles: false,
      publicRoutes: false,
      accounts: false,
      mail: false,
      signIn: false,
      households: false,
      notify: false,
      ai: false
    })

    const install = (body: unknown) => call(`/plugins/packages/${token}/install`, adminCookie, 'POST', body)
    // The server admin's own password first: a device left open on /server installs nothing.
    assert.equal((await install({ acceptUnsigned: true })).status, 403)
    assert.equal((await install({ acceptUnsigned: true, password: 'pas le bon' })).status, 403)
    assert.equal((await install({ password: ADMIN_PASSWORD })).status, 409)
    assert.equal(restarts, 0)
    const done = await install({ acceptUnsigned: true, password: ADMIN_PASSWORD })
    assert.equal(done.status, 202)
    assert.deepEqual(await done.json(), { installed: 'other', version: '0.1.0', restarting: true })
    assert.equal(restarts, 1)
    assert.equal(existsSync(path.join(pluginDir, 'other', 'plugin.json')), true)

    assert.equal((await call('/plugins/other', memberCookie, 'DELETE')).status, 403)
    assert.equal((await call('/plugins/other', adminCookie, 'DELETE')).status, 403)
    assert.equal(restarts, 1)
    const proof = { password: ADMIN_PASSWORD }
    assert.equal((await call('/plugins/other', adminCookie, 'DELETE', proof)).status, 202)
    assert.equal(restarts, 2)
    assert.equal((await call('/plugins/other', adminCookie, 'DELETE', proof)).status, 404)
  })
})

// A package as `npm run build` of a plugin makes it: its folder, gzipped in a tar.
const makePackage = async (files: Record<string, string>, links: Record<string, string> = {}) => {
  const root = mkdtempSync(path.join(tmpdir(), 'hodi-package-'))
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
    writeFileSync(path.join(root, name), content)
  }
  for (const [name, target] of Object.entries(links)) symlinkSync(target, path.join(root, name))
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'hodi-tgz-')), 'plugin.hodi-plugin')
  await createTar({ gzip: true, file, cwd: root, portable: true }, readdirSync(root))
  return readFileSync(file)
}

const signWith = (privateKey: KeyObject, files: Record<string, string>) => {
  const root = mkdtempSync(path.join(tmpdir(), 'hodi-sign-'))
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
    writeFileSync(path.join(root, name), content)
  }
  return { ...files, signature: sign(null, packageDigest(root), privateKey).toString('base64') }
}

describe('plugin packages', () => {
  const files = { 'plugin.json': JSON.stringify(MANIFEST), 'server.js': HELLO_SERVER, 'locales/fr.json': '{}' }
  const keys = generateKeyPairSync('ed25519')
  const trusted = [keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()]
  const into = () => path.join(mkdtempSync(path.join(tmpdir(), 'hodi-unpack-')), 'plugin')

  it('trusts only valid ed25519 public keys', () => {
    assert.ok(TRUSTED_KEYS.length > 0)
    for (const key of TRUSTED_KEYS) {
      const parsed = createPublicKey(key)
      assert.equal(parsed.type, 'public')
      assert.equal(parsed.asymmetricKeyType, 'ed25519')
    }
  })

  it('unpacks a package and reads its manifest', async () => {
    const unpacked = await unpackPackage(await makePackage(files), into(), trusted)
    assert.equal(unpacked.manifest.id, 'hello')
    assert.equal(unpacked.signed, false)
  })

  it('trusts a signature only from a known key over exactly these files', async () => {
    assert.equal(
      (await unpackPackage(await makePackage(signWith(keys.privateKey, files)), into(), trusted)).signed,
      true
    )

    const tampered = { ...signWith(keys.privateKey, files), 'server.js': 'export default {}' }
    assert.equal((await unpackPackage(await makePackage(tampered), into(), trusted)).signed, false)

    const stranger = generateKeyPairSync('ed25519').privateKey
    assert.equal((await unpackPackage(await makePackage(signWith(stranger, files)), into(), trusted)).signed, false)
  })

  it('refuses links, a wrong manifest and what is not a package', async () => {
    await assert.rejects(unpackPackage(await makePackage(files, { 'secret.js': '/etc/passwd' }), into()), {
      code: 'not_a_package'
    })
    await assert.rejects(
      unpackPackage(await makePackage({ 'plugin.json': JSON.stringify({ ...MANIFEST, api: 99 }) }), into()),
      { code: 'invalid_manifest' }
    )
    await assert.rejects(unpackPackage(await makePackage({ 'server.js': 'x' }), into()), { code: 'invalid_manifest' })
    await assert.rejects(unpackPackage(Buffer.from('not a tar at all'), into()), { code: 'not_a_package' })
  })

  it('stages, installs, updates and removes a plugin', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'hodi-plugins-'))
    let installed: string | null = null
    const installer = new PluginInstaller({ dir, keys: trusted, installedVersion: () => installed })

    const staged = await installer.stage(await makePackage(files))
    assert.deepEqual([staged.manifest.id, staged.signed, staged.replaces], ['hello', false, null])
    assert.equal(installer.install(staged.token, { acceptUnsigned: false }), 'unsigned')
    assert.equal(installer.install('nope', { acceptUnsigned: true }), null)
    assert.equal((installer.install(staged.token, { acceptUnsigned: true }) as Staged).manifest.id, 'hello')
    assert.equal(existsSync(path.join(dir, 'hello', 'server.js')), true)
    // A token serves once.
    assert.equal(installer.install(staged.token, { acceptUnsigned: true }), null)

    installed = '0.1.0'
    const update = await installer.stage(
      await makePackage(signWith(keys.privateKey, { 'plugin.json': JSON.stringify({ ...MANIFEST, version: '0.2.0' }) }))
    )
    assert.deepEqual([update.signed, update.replaces], [true, '0.1.0'])
    installer.install(update.token, { acceptUnsigned: false })
    // The update replaced the folder whole: the old server.js is gone with it.
    assert.equal(existsSync(path.join(dir, 'hello', 'server.js')), false)
    assert.equal(JSON.parse(readFileSync(path.join(dir, 'hello', 'plugin.json'), 'utf8')).version, '0.2.0')

    assert.equal(installer.remove('hello'), true)
    assert.equal(installer.remove('hello'), false)
    assert.equal(installer.remove('../etc'), false)
    assert.deepEqual(
      readdirSync(dir).filter(name => !name.startsWith('.')),
      []
    )
  })

  it('installs a plugin asking for accounts, households, sign-ins, mail or notifications only when it is signed', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'hodi-plugins-'))
    const installer = new PluginInstaller({ dir, keys: trusted, installedVersion: () => null })
    for (const permission of SIGNED_ONLY) {
      const asking = { ...files, 'plugin.json': JSON.stringify({ ...MANIFEST, permissions: { [permission]: true } }) }
      const unsigned = await installer.stage(await makePackage(asking))
      assert.deepEqual(unsigned.signed, false)
      // Not even with the admin's yes to an unsigned package.
      assert.equal(installer.install(unsigned.token, { acceptUnsigned: true }), 'signed_only', permission)
      assert.equal(existsSync(path.join(dir, 'hello')), false)

      const signed = await installer.stage(await makePackage(signWith(keys.privateKey, asking)))
      assert.equal((installer.install(signed.token, { acceptUnsigned: false }) as Staged).signed, true, permission)
      installer.remove('hello')

      // « npx hodi-plugin dev » keeps them, to test them.
      const dev = await installer.stage(await makePackage(asking))
      assert.equal((installer.install(dev.token, { acceptUnsigned: true, dev: true }) as Staged).signed, false)
      installer.remove('hello')
    }
  })
})

// API 1 plugins kept their tables in Hodi's database: the first start with a database of its own copies them there.
describe('legacy plugin tables', () => {
  const legacyDb = () => {
    const db = openDatabase(':memory:')
    db.exec(`CREATE TABLE plugin_diag_reports (id INTEGER PRIMARY KEY, title TEXT NOT NULL, shot BLOB)
      ;CREATE INDEX plugin_diag_reports_title ON plugin_diag_reports (title)
      ;CREATE TABLE plugin_other_notes (id INTEGER PRIMARY KEY)`)
    db.prepare('INSERT INTO plugin_diag_reports (title, shot) VALUES (?, ?), (?, NULL)').run(
      'Le Soir',
      new Uint8Array([137, 80, 78, 71]),
      'RTBF'
    )
    db.prepare('INSERT INTO plugin_other_notes (id) VALUES (1)').run()
    return db
  }

  it('copies the plugin’s own tables, rows and indexes once, and leaves Hodi’s copy alone', () => {
    const db = legacyDb()
    const store = new PluginStore(db)
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'hodi-legacy-')), 'plugin.db')

    assert.deepEqual(store.copyLegacyTables('diag', file), { copied: 1, skipped: [] })
    const copy = new DatabaseSync(file)
    const rows = copy.prepare('SELECT title, shot FROM plugin_diag_reports ORDER BY id').all() as {
      title: string
      shot: Uint8Array | null
    }[]
    assert.deepEqual(
      rows.map(row => [row.title, row.shot && [...row.shot]]),
      [
        ['Le Soir', [137, 80, 78, 71]],
        ['RTBF', null]
      ]
    )
    const names = (
      copy.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'plugin_%'").all() as { name: string }[]
    )
      .map(row => row.name)
      .sort()
    assert.deepEqual(names, ['plugin_diag_reports', 'plugin_diag_reports_title'])
    copy.exec("INSERT INTO plugin_diag_reports (title) VALUES ('7sur7')")
    copy.close()

    // Never again once the file exists: the plugin's own rows win.
    assert.equal(store.copyLegacyTables('diag', file).copied, 0)
    const again = new DatabaseSync(file)
    assert.equal((again.prepare('SELECT COUNT(*) AS n FROM plugin_diag_reports').get() as { n: number }).n, 3)
    again.close()
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM plugin_diag_reports').get() as { n: number }).n, 2)
  })

  it('leaves out a virtual table and its shadow tables, and says so', () => {
    const db = legacyDb()
    db.exec('CREATE VIRTUAL TABLE plugin_diag_search USING fts5(text)')
    db.prepare("INSERT INTO plugin_diag_search (text) VALUES ('Le Soir')").run()
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'hodi-legacy-')), 'plugin.db')
    const { copied, skipped } = new PluginStore(db).copyLegacyTables('diag', file)
    assert.equal(copied, 1)
    assert.ok(skipped.includes('plugin_diag_search'))
    assert.ok(skipped.every(name => name.startsWith('plugin_diag_search')))
    assert.ok(skipped.length > 1)
  })

  it('makes no file for a plugin that had no tables', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'hodi-legacy-')), 'plugin.db')
    assert.equal(new PluginStore(legacyDb()).copyLegacyTables('hello', file).copied, 0)
    assert.equal(existsSync(file), false)
  })

  it('hands the copy to the plugin’s sandbox at its first start', async () => {
    const db = legacyDb()
    const dir = mkdtempSync(path.join(tmpdir(), 'hodi-plugins-'))
    writePlugin(
      dir,
      'diag',
      { ...MANIFEST, id: 'diag', settings: [] },
      `export default {
        routes: { 'GET /count': async (_request, ctx) => ({ body: ctx.db.query('SELECT COUNT(*) AS n FROM plugin_diag_reports')[0] }) }
      }`
    )
    signFolder(path.join(dir, 'diag'))
    const lines: string[] = []
    const registry = await load({
      dir,
      dataDir: mkdtempSync(path.join(tmpdir(), 'hodi-plugin-data-')),
      store: new PluginStore(db),
      trustedKeys: TEST_TRUSTED,
      log: line => lines.push(line)
    })
    assert.ok(lines.some(line => line.includes('1 tables copied')))
    assert.deepEqual(await registry.get('diag')!.sandbox!.call('routes', 'GET /count', {}), { body: { n: 2 } })
  })
})

// A plugin's data belongs to whoever made it, not to its id.
describe('plugin data owner', () => {
  const NOTES = (tag: string) => `
    // ${tag}
    export default {
      migrations: ['CREATE TABLE notes (text TEXT)'],
      routes: {
        'POST /note': async (request, ctx) => { ctx.db.run('INSERT INTO notes (text) VALUES (?)', [request.body.text]); return { status: 201 } },
        'GET /notes': async (_request, ctx) => ({ body: ctx.db.query('SELECT text FROM notes') })
      }
    }`
  const setup = () => {
    const db = openDatabase(':memory:')
    db.exec('CREATE TABLE plugin_vault_accounts (email TEXT)')
    db.prepare("INSERT INTO plugin_vault_accounts (email) VALUES ('lea@exemple.be')").run()
    return {
      db,
      store: new PluginStore(db),
      dir: mkdtempSync(path.join(tmpdir(), 'hodi-plugins-')),
      dataDir: mkdtempSync(path.join(tmpdir(), 'hodi-plugin-data-'))
    }
  }
  const write = (dir: string, tag: string, signed: boolean) => {
    rmSync(path.join(dir, 'vault'), { recursive: true, force: true })
    writePlugin(dir, 'vault', { ...MANIFEST, id: 'vault', audience: 'admin', settings: [] }, NOTES(tag))
    if (signed) signFolder(path.join(dir, 'vault'))
  }
  const start = async ({ store, dir, dataDir }: ReturnType<typeof setup>, lines: string[] = []) => {
    const registry = await loadPlugins({
      dir,
      dataDir,
      store,
      trustedKeys: TEST_TRUSTED,
      log: line => lines.push(line)
    })
    const notes = async () =>
      ((await registry.get('vault')!.sandbox!.call('routes', 'GET /notes', {})) as { body: unknown }).body
    return { registry, notes }
  }
  const tables = async (registry: PluginRegistry) =>
    ((await registry.get('vault')!.sandbox!.call('routes', 'GET /notes', {})) as { body: unknown[] }).body.length

  it('keeps the data of an update signed with the same key, and copies API 1 tables for it', async () => {
    const env = setup()
    write(env.dir, 'v1', true)
    const lines: string[] = []
    const first = await start(env, lines)
    assert.ok(lines.some(line => line.includes('1 tables copied')))
    await first.registry.get('vault')!.sandbox!.call('routes', 'POST /note', { body: { text: 'secret' } })
    env.store.updateSettings('vault', { token: 'sk-test-1' })
    await first.registry.stop()

    write(env.dir, 'v2', true)
    const second = await start(env)
    assert.deepEqual(await second.notes(), [{ text: 'secret' }])
    assert.deepEqual(env.store.state('vault', 0).settings, { token: 'sk-test-1' })
    await second.registry.stop()
  })

  it('gives an unsigned plugin taking a removed plugin’s id none of its data', async () => {
    const env = setup()
    write(env.dir, 'official', true)
    const first = await start(env)
    await first.registry.get('vault')!.sandbox!.call('routes', 'POST /note', { body: { text: 'secret' } })
    env.store.updateSettings('vault', { token: 'sk-test-1' })
    await first.registry.stop()

    // Removed, data kept; then a stranger's plugin with the same id.
    write(env.dir, 'stranger', false)
    const lines: string[] = []
    const second = await start(env, lines)
    assert.deepEqual(await second.notes(), [])
    assert.deepEqual(env.store.state('vault', 0).settings, {})
    assert.ok(lines.some(line => line.includes('starts with none')))
    assert.ok(readdirSync(env.dataDir).some(name => name.startsWith('vault.orphan-')))
    await second.registry.stop()
    // No API 1 table copied for it either.
    const own = new DatabaseSync(path.join(env.dataDir, 'vault', 'plugin.db'))
    assert.equal(own.prepare("SELECT name FROM sqlite_master WHERE name = 'plugin_vault_accounts'").get(), undefined)
    own.close()
  })

  it('gives a changed unsigned plugin a fresh start too', async () => {
    const env = setup()
    write(env.dir, 'mine', false)
    const first = await start(env)
    await first.registry.get('vault')!.sandbox!.call('routes', 'POST /note', { body: { text: 'a' } })
    await first.registry.stop()
    // The same files: same data.
    const again = await start(env)
    assert.equal(await tables(again.registry), 1)
    await again.registry.stop()
    // Other files under the same id: nobody vouches they are the same maker's.
    write(env.dir, 'changed', false)
    const changed = await start(env)
    assert.equal(await tables(changed.registry), 0)
    await changed.registry.stop()
  })

  it('deletes everything a removed plugin kept when asked', async () => {
    const env = setup()
    write(env.dir, 'official', true)
    const { registry } = await start(env)
    await registry.forget('vault')
    assert.equal(existsSync(path.join(env.dataDir, 'vault')), false)
    assert.equal(env.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'plugin_vault_%'").get()?.n, 0)
    assert.equal(env.db.prepare("SELECT COUNT(*) AS n FROM plugins WHERE id = 'vault'").get()?.n, 0)
    // Its core rows are not someone else's: plugins and plugin_migrations stay.
    assert.ok(env.db.prepare("SELECT name FROM sqlite_master WHERE name = 'plugin_migrations'").get())
    await registry.stop()
  })
})

describe('plugin data from before owners were recorded', () => {
  it('is kept by a signed plugin only', async () => {
    for (const signed of [true, false]) {
      const db = openDatabase(':memory:')
      const store = new PluginStore(db)
      const dir = mkdtempSync(path.join(tmpdir(), 'hodi-plugins-'))
      const dataDir = mkdtempSync(path.join(tmpdir(), 'hodi-plugin-data-'))
      writePlugin(dir, 'keep', { ...MANIFEST, id: 'keep', settings: [] }, 'export default { routes: {} }')
      if (signed) signFolder(path.join(dir, 'keep'))
      mkdirSync(path.join(dataDir, 'keep'))
      writeFileSync(path.join(dataDir, 'keep', 'left.txt'), 'old')
      const registry = await load({ dir, dataDir, store, trustedKeys: TEST_TRUSTED, log: () => {} })
      assert.equal(existsSync(path.join(dataDir, 'keep', 'left.txt')), signed, `signed: ${signed}`)
      await registry.stop()
    }
  })
})

describe('the server settings a plugin reads', () => {
  it('gives every plugin what Serveur › Contenu and Sauvegardes promise, read only', async () => {
    const db = openDatabase(':memory:')
    const dir = mkdtempSync(path.join(tmpdir(), 'hodi-plugins-'))
    const dataDir = mkdtempSync(path.join(tmpdir(), 'hodi-plugin-data-'))
    writePlugin(
      dir,
      'legal',
      { ...MANIFEST, id: 'legal', settings: [] },
      `export default { routes: { 'GET /days': async (_request, ctx) => ({ body: await ctx.serverSettings() }) } }`
    )
    const settings = new ServerSettingsStore(db)
    settings.setContent({ articleDays: 5 })
    settings.setMaxSources(100)
    const registry = await loadPlugins({
      dir,
      dataDir,
      store: new PluginStore(db),
      serverSettings: () => publicServerSettings(settings)
    })
    const answer = (await registry.get('legal')!.sandbox!.call('routes', 'GET /days', {})) as { body: unknown }
    assert.deepEqual(answer.body, { articleDays: 5, videoDays: 60, textDays: 7, backupCopies: 7, maxSources: 100 })
    await registry.stop()
    rmSync(dir, { recursive: true, force: true })
    rmSync(dataDir, { recursive: true, force: true })
  })
})

// Accounts, households, sign-ins, mail and notifications: an unsigned plugin asking for one does not run, whatever
// put it in the plugins' folder (an install from before the rule, a copy by hand).
describe('signed-only permissions', () => {
  for (const permission of SIGNED_ONLY) {
    it(`loads a plugin asking for permissions.${permission} only signed or from « npx hodi-plugin dev »`, async () => {
      const store = new PluginStore(openDatabase(':memory:'))
      const dir = mkdtempSync(path.join(tmpdir(), 'hodi-plugins-'))
      const manifest = (id: string) => ({ ...MANIFEST, id, settings: [], permissions: { [permission]: true } })
      writePlugin(dir, 'unsigned', manifest('unsigned'), HELLO_SERVER)
      writePlugin(dir, 'signed', manifest('signed'), HELLO_SERVER)
      signFolder(path.join(dir, 'signed'))
      writePlugin(dir, 'built', manifest('built'), HELLO_SERVER)
      store.startDevMode(0)
      store.setDev('built', 0)
      const registry = await load({
        dir,
        dataDir: mkdtempSync(path.join(tmpdir(), 'hodi-plugin-data-')),
        store,
        trustedKeys: TEST_TRUSTED,
        log: () => {}
      })
      const unsigned = registry.get('unsigned')!
      assert.equal(unsigned.sandbox, null)
      assert.equal(unsigned.error, `only a verified plugin may ask for permissions.${permission}`)
      // Still listed by its name, so the admin knows which plugin was refused.
      assert.equal(unsigned.manifest?.id, 'unsigned')
      assert.notEqual(registry.get('signed')!.sandbox, null)
      assert.notEqual(registry.get('built')!.sandbox, null)
    })
  }
})
