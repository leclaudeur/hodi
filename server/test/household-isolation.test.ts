import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { createApp } from '../app.ts'
import { hashPassword } from '../auth/password.ts'
import type { Config } from '../config.ts'
import { openDatabase } from '../db/database.ts'
import { inHousehold } from '../db/household-scope.ts'
import { HouseholdStore } from '../db/household-store.ts'
import { ProfileStore } from '../db/profile-store.ts'
import { SignInCodeStore } from '../db/sign-in-code-store.ts'
import { UserAccountStore } from '../db/user-account-store.ts'
import { UserDeviceStore } from '../db/user-device-store.ts'
import { UserStore } from '../db/user-store.ts'
import { parseCatalog } from '../news/catalog.ts'
import { NewsService } from '../news/news-service.ts'
import { fakeFetch } from './helpers/news.ts'

const PASSWORD = 'une phrase de passe assez longue'
const DUPONT = 'claire@example.com'
const MARTIN = 'marc@example.com'

const cookiesFrom = (response: Response) =>
  response.headers
    .getSetCookie()
    .map(cookie => cookie.split(';')[0])
    .join('; ')

// The core makes one household; a plugin may add others. Here a second one is written in by hand, as a plugin would,
// and nothing the Martins do reaches the Duponts, or the other way round.
describe('two households on one server', () => {
  const db = openDatabase(':memory:')
  let baseUrl = ''
  let close = () => {}
  let dupont = ''
  let martin = ''
  let martinAdmin = 0
  let martinTeen = 0
  let dupontAdmin = 0

  const call = (url: string, cookie: string, method = 'GET', body?: unknown) =>
    fetch(`${baseUrl}/api${url}`, {
      method,
      headers: { cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  const json = async <T>(url: string, cookie: string) => (await (await call(url, cookie)).json()) as T
  const profileIds = async (cookie: string) =>
    (await json<{ profiles: { id: number }[] }>('/profiles', cookie)).profiles.map(profile => profile.id)

  before(async () => {
    const webDir = mkdtempSync(path.join(tmpdir(), 'hodi-web-'))
    writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>Hodi</title>')
    const config: Config = {
      host: '127.0.0.1',
      port: 0,
      sessionSecret: Buffer.alloc(32, 7),
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
      profiles: new ProfileStore(db),
      household: new HouseholdStore(db),
      accounts,
      devices: new UserDeviceStore(db),
      codes: new SignInCodeStore(db, config.sessionSecret),
      users: id => new UserStore(db, id)
    }).listen(0)
    await new Promise(resolve => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    close = () => server.close()

    // The Duponts: the core's own household, made by the setup.
    const account = await call('/setup/account', '', 'POST', { email: DUPONT, password: PASSWORD })
    const done = await call('/setup', cookiesFrom(account), 'POST', {
      name: 'Famille Dupont',
      profile: { name: 'Claire', color: 'tech' },
      timeZone: 'Europe/Brussels',
      ai: null
    })
    assert.equal(done.status, 200)
    dupont = `${cookiesFrom(account)}; ${cookiesFrom(done)}`
    dupontAdmin = (await profileIds(dupont))[0]!

    // The Martins: a second household, its admin with an account, and a teen.
    const now = Date.now()
    db.prepare(
      `INSERT INTO accounts (id, name, created_at, set_up_at, time_zone, language) VALUES (2, 'Famille Martin', ?, ?, 'Europe/Paris', 'fr')`
    ).run(now, now)
    const martins = new ProfileStore(db, 2)
    const marc = martins.create('Marc', 'world', now)!
    db.prepare("UPDATE profiles SET role = 'admin' WHERE id = ?").run(marc.id)
    martinAdmin = marc.id
    martinTeen = martins.create('Léo', 'sport', now, { kind: 'teen' })!.id
    const user = accounts.create(MARTIN, await hashPassword(PASSWORD), now)!
    accounts.linkProfile(user.id, marc.id)

    const login = await call('/login', '', 'POST', { email: MARTIN, password: PASSWORD })
    assert.equal(login.status, 204)
    martin = cookiesFrom(login)
  })

  after(() => close())

  it('shows each household its own profiles and settings only', async () => {
    assert.deepEqual(await profileIds(martin), [martinAdmin, martinTeen])
    assert.ok(!(await profileIds(dupont)).includes(martinAdmin))
    const session = await json<{ profileChosen: boolean }>('/session', martin)
    assert.equal(session.profileChosen, true)
    assert.equal((await json<{ name: string }>('/household', martin)).name, 'Famille Martin')
    assert.equal((await json<{ name: string }>('/household', dupont)).name, 'Famille Dupont')
  })

  it('never opens or changes a profile of the other household', async () => {
    // « Qui lit ? » with a profile of the Duponts: not one of the Martins'.
    assert.equal((await call('/profiles/current', martin, 'PUT', { id: dupontAdmin })).status, 400)
    assert.equal((await call('/profiles/current', dupont, 'PUT', { id: martinTeen })).status, 400)
    assert.equal((await call(`/profiles/${dupontAdmin}`, martin, 'PATCH', { name: 'Volé' })).status, 404)
    assert.equal((await call(`/profiles/${dupontAdmin}`, martin, 'DELETE')).status, 404)
    const names = (await json<{ profiles: { name: string }[] }>('/profiles', dupont)).profiles.map(p => p.name)
    assert.deepEqual(names, ['Claire'])
  })

  it('shares within the household only', async () => {
    const targets = await json<{ profiles: number[] }>('/me/share-targets', martin)
    assert.deepEqual(targets.profiles, [martinTeen])
    assert.deepEqual((await json<{ profiles: number[] }>('/me/share-targets', dupont)).profiles, [])
  })

  it("makes a household's codes for that household", async () => {
    const made = await call('/codes', martin, 'POST', {})
    assert.equal(made.status, 201)
    const { code } = (await made.json()) as { code: string }
    const checked = (await (await call('/codes/check', '', 'POST', { code })).json()) as { household: string }
    assert.equal(checked.household, 'Famille Martin')
    const joined = await call('/codes/join', '', 'POST', {
      code,
      email: 'julie@example.com',
      password: PASSWORD,
      ageConfirmed: true,
      profile: { name: 'Julie', color: 'world' }
    })
    assert.equal(joined.status, 200)
    const julie = cookiesFrom(joined)
    const ids = await profileIds(julie)
    assert.equal(ids.length, 3)
    assert.ok(ids.includes(martinAdmin))
    assert.deepEqual(
      (await json<{ profiles: { name: string }[] }>('/profiles', dupont)).profiles.map(p => p.name),
      ['Claire']
    )
  })
})

describe("each household's catalogue in the news service", () => {
  const catalogOf = (sourceId: string) =>
    parseCatalog(
      `topics:\n  - id: monde\n    label: Monde\n    sources:\n      - id: ${sourceId}\n        name: ${sourceId}\n        url: https://${sourceId}.example/feed\n        domains: [${sourceId}.example]\nlisten: []\n`
    )
  const sourceIds = (news: NewsService) => news.catalog.topics.flatMap(topic => topic.sources.map(source => source.id))

  it('lists, adds and removes in the household of the request only', () => {
    const news = new NewsService(catalogOf('dupont'), {
      fetchText: fakeFetch({}).fetchText,
      catalogOf: () => catalogOf('martin'),
      households: () => [1, 2],
      log: () => {}
    })
    assert.deepEqual(sourceIds(news), ['dupont'])
    assert.deepEqual(
      inHousehold(2, () => sourceIds(news)),
      ['martin']
    )
    inHousehold(2, () => news.removeSource('martin'))
    assert.deepEqual(
      inHousehold(2, () => sourceIds(news)),
      []
    )
    assert.deepEqual(sourceIds(news), ['dupont'])
  })
})
