import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { createApp } from '../app.ts'
import { LoginThrottle } from '../auth/login-throttle.ts'
import type { Config } from '../config.ts'
import { openDatabase } from '../db/database.ts'
import { HouseholdStore } from '../db/household-store.ts'
import { ProfileStore } from '../db/profile-store.ts'
import type { AiProvider } from '../news/ai-providers.ts'
import { parseCatalog } from '../news/catalog.ts'
import { NewsService } from '../news/news-service.ts'
import { fakeFetch } from './helpers/news.ts'

const PASSWORD = 'une phrase de passe assez longue'
const CODE = '123456'

// A provider whose only good key is sk-test-good…, and that never calls anything.
const fakeAi: AiProvider = {
  id: 'fake',
  name: 'Fausse IA',
  defaultModel: 'fake-1',
  keysUrl: 'https://example.com/keys',
  keyPattern: /^sk-test-\w{8,}$/,
  checkKey: async key => (key.startsWith('sk-test-good') ? 'ok' : 'invalid'),
  tools: () => {
    throw new Error('not used')
  }
}

let baseUrl: string
let close: () => void
let changes = 0
const db = openDatabase(':memory:')
const household = new HouseholdStore(db)
const profiles = new ProfileStore(db)

before(async () => {
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
    maxSources: 200,
    vapid: { publicKey: 'unused', privateKey: 'unused', subject: 'mailto:test@example.com' }
  }
  const catalog = parseCatalog('topics:\n  - id: monde\n    label: Monde\n    sources: []\n')
  const server = createApp(config, {
    news: new NewsService(catalog, { fetchText: fakeFetch({}).fetchText, log: () => {} }),
    profiles,
    household,
    setupCode: CODE,
    aiProviders: [fakeAi],
    onHouseholdChange: () => {
      changes += 1
    },
    throttle: new LoginThrottle(5, 60_000)
  }).listen(0)
  await new Promise(resolve => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  close = () => server.close()
})

after(() => close())

const post = (url: string, body: unknown, headers: Record<string, string> = {}, method = 'POST') =>
  fetch(`${baseUrl}/api${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  })

const cookiesFrom = (response: Response) =>
  response.headers
    .getSetCookie()
    .map(cookie => cookie.split(';')[0])
    .join('; ')

const SETUP = {
  name: 'Chez nous',
  password: PASSWORD,
  profile: { name: 'Antho', color: 'tech' },
  timeZone: 'Europe/Brussels',
  country: 'BE',
  ai: null
}

// Through a reverse proxy, as on a server on the internet.
const PROXIED = { 'X-Forwarded-For': '203.0.113.7' }

describe('household', () => {
  it('waits for its first-run screens: no login, no API', async () => {
    const state = await (await fetch(`${baseUrl}/api/setup`)).json()
    assert.equal(state.needed, true)
    assert.equal(state.codeRequired, false)
    assert.deepEqual(state.providers, [{ id: 'fake', name: 'Fausse IA', keysUrl: 'https://example.com/keys' }])

    const proxied = await (await fetch(`${baseUrl}/api/setup`, { headers: PROXIED })).json()
    assert.equal(proxied.codeRequired, true)

    assert.equal((await post('/login', { password: PASSWORD })).status, 409)
    const api = await fetch(`${baseUrl}/api/session`)
    assert.equal(api.status, 401)
    assert.deepEqual(await api.json(), { error: 'setup_required' })
  })

  it('asks for the code away from the server, and checks a key only on demand', async () => {
    assert.equal((await post('/setup/code', { code: '000000' }, PROXIED)).status, 403)
    assert.equal((await post('/setup/code', { code: CODE }, PROXIED)).status, 204)
    assert.equal((await post('/setup', { ...SETUP, code: '000000' }, PROXIED)).status, 403)

    const good = await post('/setup/ai-check', { provider: 'fake', key: 'sk-test-good1234' })
    assert.deepEqual(await good.json(), { result: 'ok' })
    const bad = await post('/setup/ai-check', { provider: 'fake', key: 'sk-test-wrong1234' })
    assert.deepEqual(await bad.json(), { result: 'invalid' })
    const pasted = await post('/setup/ai-check', { provider: 'fake', key: 'not a key' })
    assert.deepEqual(await pasted.json(), { result: 'invalid' })
  })

  it('refuses a short password or a wrong region', async () => {
    assert.equal((await post('/setup', { ...SETUP, password: 'court' })).status, 400)
    assert.equal((await post('/setup', { ...SETUP, timeZone: 'Mars/Olympus' })).status, 400)
    assert.equal((await post('/setup', { ...SETUP, country: 'Belgique' })).status, 400)
    assert.equal((await post('/setup', { ...SETUP, language: 'nl' })).status, 400)
    assert.equal(household.isSetUp(), false)
  })

  it('sets up the household and its admin, signed in on this device, once', async () => {
    const response = await post('/setup', { ...SETUP, ai: { provider: 'fake', key: 'sk-test-good1234' } })
    assert.equal(response.status, 200)
    const cookie = cookiesFrom(response)
    assert.match(cookie, /hodi_session=v1\./)
    assert.match(cookie, /hodi_profile=/)

    const session = await (await fetch(`${baseUrl}/api/session`, { headers: { cookie } })).json()
    assert.deepEqual(session, { authenticated: true, profileChosen: true, language: 'fr', hourCycle: 24 })
    const [admin] = profiles.list()
    assert.equal(admin?.name, 'Antho')
    assert.equal(admin?.color, 'tech')
    assert.equal(admin?.tourPending, false)
    assert.equal(changes, 1)

    const view = await (await fetch(`${baseUrl}/api/household`, { headers: { cookie } })).json()
    assert.equal(view.name, 'Chez nous')
    assert.equal(view.timeZone, 'Europe/Brussels')
    assert.equal(view.country, 'BE')
    assert.deepEqual(view.ai, {
      provider: 'fake',
      providerName: 'Fausse IA',
      model: 'fake-1',
      keyHint: 'sk-test-••••1234'
    })

    assert.equal((await post('/setup', SETUP)).status, 409)
    assert.deepEqual(await (await fetch(`${baseUrl}/api/setup`)).json(), {
      needed: false,
      name: 'Chez nous',
      language: 'fr'
    })
    assert.equal((await post('/login', { password: PASSWORD })).status, 204)
  })

  it('keeps the language chosen at setup, which the admin can change', async () => {
    const cookie = cookiesFrom(await post('/login', { password: PASSWORD }))
    const session = await (await fetch(`${baseUrl}/api/session`, { headers: { cookie } })).json()
    assert.equal(session.language, 'fr')
    assert.equal((await (await fetch(`${baseUrl}/api/setup`)).json()).language, 'fr')

    const patch = (body: unknown) => post('/household', body, { cookie }, 'PATCH')
    assert.equal((await (await patch({ language: 'en' })).json()).language, 'en')
    assert.equal((await patch({ language: 'nl' })).status, 400)

    // The time of day, for every device: 24 h until the admin picks 12 h.
    assert.equal((await (await patch({ hourCycle: 12 })).json()).hourCycle, 12)
    assert.equal((await (await fetch(`${baseUrl}/api/session`, { headers: { cookie } })).json()).hourCycle, 12)
    assert.equal((await patch({ hourCycle: 13 })).status, 400)
    assert.equal(household.get().language, 'en')
    assert.equal((await (await fetch(`${baseUrl}/api/setup`)).json()).language, 'en')
    await patch({ language: 'fr' })
  })

  it('lets the admin rename it, move it and change or drop its AI', async () => {
    const cookie = cookiesFrom(await post('/login', { password: PASSWORD }))
    const patch = (body: unknown) => post('/household', body, { cookie }, 'PATCH')

    assert.equal((await (await patch({ name: '  La   maison ' })).json()).name, 'La maison')
    assert.equal((await patch({ name: '' })).status, 400)
    const moved = await (await patch({ timeZone: 'America/Montreal', country: null })).json()
    assert.equal(moved.timeZone, 'America/Montreal')
    assert.equal(moved.country, null)
    assert.equal(changes, 2)

    const refused = await post('/household/ai', { provider: 'fake', key: 'sk-test-wrong1234' }, { cookie }, 'PUT')
    assert.equal(refused.status, 422)
    assert.equal(household.get().ai?.key, 'sk-test-good1234')
    const dropped = await (await fetch(`${baseUrl}/api/household/ai`, { method: 'DELETE', headers: { cookie } })).json()
    assert.equal(dropped.ai, null)
    assert.equal(changes, 3)
  })

  it('is the admin’s only', async () => {
    const cookie = cookiesFrom(await post('/login', { password: PASSWORD }))
    const member = profiles.create('Léa', 'monde', 0)!
    const chosen = await post(`/profiles/current`, { id: member.id }, { cookie }, 'PUT')
    const asMember = `${cookie}; ${cookiesFrom(chosen)}`
    assert.equal((await fetch(`${baseUrl}/api/household`, { headers: { cookie: asMember } })).status, 403)
  })

  it('signs out the other devices but this one, keeping the password', async () => {
    const other = cookiesFrom(await post('/login', { password: PASSWORD }))
    const mine = cookiesFrom(await post('/login', { password: PASSWORD }))
    const session = (cookie: string) => fetch(`${baseUrl}/api/session`, { headers: { cookie } })

    const revoked = await post('/household/sessions/revoke', undefined, { cookie: mine })
    assert.equal(revoked.status, 204)
    assert.equal((await session(other)).status, 401)
    assert.equal((await session(mine)).status, 401)
    const renewed = cookiesFrom(revoked)
    assert.equal((await session(renewed)).status, 200)

    // A new sign-in, with the same password, gets a session of the new generation.
    const again = cookiesFrom(await post('/login', { password: PASSWORD }))
    assert.equal((await session(again)).status, 200)
  })

  it('changes the password, signing out the other devices but this one', async () => {
    const other = cookiesFrom(await post('/login', { password: PASSWORD }))
    const mine = cookiesFrom(await post('/login', { password: PASSWORD }))
    const change = (current: string) =>
      post('/household/password', { current, next: 'une toute nouvelle phrase' }, { cookie: mine }, 'PUT')

    assert.equal((await change('pas le bon')).status, 403)
    const changed = await change(PASSWORD)
    assert.equal(changed.status, 200)

    assert.equal((await fetch(`${baseUrl}/api/session`, { headers: { cookie: other } })).status, 401)
    const renewed = cookiesFrom(changed)
    assert.equal((await fetch(`${baseUrl}/api/session`, { headers: { cookie: renewed } })).status, 200)
    assert.equal((await post('/login', { password: PASSWORD })).status, 401)
    assert.equal((await post('/login', { password: 'une toute nouvelle phrase' })).status, 204)
  })
})
