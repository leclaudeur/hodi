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
import { HouseholdStore } from '../db/household-store.ts'
import { MailSettingsStore } from '../db/mail-settings-store.ts'
import { ProfileStore } from '../db/profile-store.ts'
import { ServerPeopleStore } from '../db/server-people-store.ts'
import { ServerSettingsStore } from '../db/server-settings-store.ts'
import { ServerStatsStore } from '../db/server-stats-store.ts'
import { SignInCodeStore } from '../db/sign-in-code-store.ts'
import { UserAccountStore } from '../db/user-account-store.ts'
import { UserDeviceStore } from '../db/user-device-store.ts'
import type { MailMessage } from '../mail/mailer.ts'
import { parseCatalog } from '../news/catalog.ts'
import { NewsService } from '../news/news-service.ts'
import { fakeFetch } from './helpers/news.ts'

const EMAIL = 'antho@example.com'
const PASSWORD = 'une phrase de passe assez longue'

const cookiesFrom = (response: Response) =>
  response.headers
    .getSetCookie()
    .map(cookie => cookie.split(';')[0])
    .join('; ')

// A fresh server whose setup made its admin's account and stopped there.
async function startServer() {
  const db = openDatabase(':memory:')
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
  const sent: MailMessage[] = []
  const catalog = parseCatalog('topics:\n  - id: monde\n    label: Monde\n    sources: []\n')
  const server = createApp(config, {
    news: new NewsService(catalog, { fetchText: fakeFetch({}).fetchText, log: () => {} }),
    profiles: new ProfileStore(db),
    household: new HouseholdStore(db),
    accounts: new UserAccountStore(db),
    devices: new UserDeviceStore(db),
    serverStats: new ServerStatsStore(db, () => 'UTC'),
    serverPeople: new ServerPeopleStore(db),
    serverSettings: new ServerSettingsStore(db),
    serverMail: { store: new MailSettingsStore(db), send: async (_settings, message) => void sent.push(message) },
    codes: new SignInCodeStore(db, config.sessionSecret)
  }).listen(0)
  await new Promise(resolve => server.once('listening', resolve))
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const call = (url: string, cookie: string, method = 'GET', body?: unknown) =>
    fetch(`${baseUrl}/api${url}`, {
      method,
      headers: { cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  const account = await call('/setup/account', '', 'POST', { email: EMAIL, password: PASSWORD })
  assert.equal(account.status, 204)
  return { call, db, sent, session: cookiesFrom(account), close: () => server.close() }
}

// « Aller à l'espace Serveur » once the server is set up: the server runs with its admin's account alone, in
// /server, until Serveur › Foyers brings the household steps back.
describe('a server whose household is left for later', () => {
  let call: Awaited<ReturnType<typeof startServer>>['call']
  let sent: MailMessage[] = []
  let close: () => void
  let session = ''

  before(async () => {
    ;({ call, close, session, sent } = await startServer())
  })

  after(() => close())

  it('asks for the admin signed in to leave the household for later', async () => {
    assert.equal((await call('/setup/later', '', 'POST')).status, 401)
    assert.equal((await call('/setup/later', session, 'POST')).status, 204)

    // Connexion, as on a set-up server, with no household's name.
    const setup = (await (await call('/setup', '')).json()) as { needed: boolean; name: string | null }
    assert.deepEqual([setup.needed, setup.name], [false, null])
    // A device signed in with nothing goes to Connexion, not to the setup.
    const anonymous = await call('/session', '')
    assert.equal(anonymous.status, 401)
    assert.equal(((await anonymous.json()) as { error: string }).error, 'unauthenticated')
  })

  it('opens /server alone to its admin, from any device that signs in', async () => {
    const login = await call('/login', '', 'POST', { email: EMAIL, password: PASSWORD })
    assert.equal(login.status, 204)
    const signedIn = cookiesFrom(login)

    for (const cookie of [session, signedIn]) {
      const current = (await (await call('/session', cookie)).json()) as {
        serverOnly?: boolean
        profileChosen: boolean
      }
      assert.deepEqual([current.serverOnly, current.profileChosen], [true, false])
    }

    const overview = (await (await call('/server/overview?days=7', signedIn)).json()) as {
      households: number
      profiles: { adults: number; young: number }
    }
    assert.equal(overview.households, 0)
    assert.deepEqual(overview.profiles, { adults: 0, young: 0 })
    const people = (await (await call('/server/households', signedIn)).json()) as { households: unknown[] }
    assert.deepEqual(people.households, [])

    // Nothing of the app: there is no household to read in.
    const feed = await call('/profiles', signedIn)
    assert.equal(feed.status, 423)
    assert.equal(((await feed.json()) as { error: string }).error, 'no_household')

    // Except the topics, sources and icons that Vue d'ensemble shows.
    assert.equal((await call('/topics', signedIn)).status, 200)
    assert.equal((await call('/sources', signedIn)).status, 200)
    assert.equal((await call('/sources/monde/icon', signedIn)).status, 204)

    // Serveur › E-mail's test goes to the admin's own address, with no profile to find it through.
    const mail = { host: 'smtp.example.com', port: 465, security: 'tls', user: null, sender: 'hodi@example.com' }
    assert.equal((await call('/server/mail', signedIn, 'PUT', mail)).status, 200)
    const test = await call('/server/mail/test', signedIn, 'POST')
    assert.deepEqual(await test.json(), { to: EMAIL })
    assert.equal(sent.at(-1)?.to, EMAIL)
  })

  it('brings the household steps back, then works as any server', async () => {
    assert.equal((await call('/server/households', session, 'POST', { for: 'me' })).status, 204)
    const setup = (await (await call('/setup', session)).json()) as {
      needed: boolean
      stage: string
      signedIn: boolean
    }
    assert.deepEqual([setup.needed, setup.stage, setup.signedIn], [true, 'household', true])

    const done = await call('/setup', session, 'POST', {
      name: 'Chez nous',
      profile: { name: 'Antho', color: 'tech' },
      timeZone: 'Europe/Brussels',
      ai: null
    })
    assert.equal(done.status, 200)
    const cookie = `${session}; ${cookiesFrom(done)}`
    const current = (await (await call('/session', cookie)).json()) as { serverOnly?: boolean; profileChosen: boolean }
    assert.deepEqual([current.serverOnly, current.profileChosen], [undefined, true])
    const people = (await (await call('/server/households', cookie)).json()) as { households: { name: string }[] }
    assert.deepEqual(
      people.households.map(entry => entry.name),
      ['Chez nous']
    )
    assert.equal((await call('/server/households', cookie, 'POST')).status, 409)
  })
})

// « Créer un foyer » for someone else went with Serveur › Foyers: the server makes no household for anyone.
describe('a household made for someone else, gone', () => {
  it('makes no household and no code for anyone', async () => {
    const { call, close, session } = await startServer()
    try {
      assert.equal((await call('/setup/later', session, 'POST')).status, 204)
      const made = await call('/server/households', session, 'POST', {
        for: 'other',
        name: 'Famille Dupont',
        admin: 'Claire',
        language: 'fr'
      })
      // Read as « Créer mon foyer »: the household steps come back for the server's admin, no code for anyone.
      assert.equal(made.status, 204)
      assert.equal(((await (await call('/setup', session)).json()) as { stage: string }).stage, 'household')
      assert.equal((await call('/server/households/1/admin-code', session, 'POST')).status, 404)
    } finally {
      close()
    }
  })
})

// An older household plugin's case: the first household left for later, and a household it made for someone else.
describe('a household a plugin made while the first one is left for later', () => {
  it('lets its people sign in and read in it, while a device signed in with nothing still goes to Connexion', async () => {
    const { call, db, session, close } = await startServer()
    after(() => close())
    assert.equal((await call('/setup/later', session, 'POST')).status, 204)

    const accounts = new UserAccountStore(db)
    const claire = accounts.create(
      'claire@example.com',
      await hashPassword('la phrase de Claire', { N: 2 ** 10, r: 8, p: 1 }),
      0
    )!
    // As an older plugin made it with ctx.households: set up at once, with its admin's profile.
    const { lastInsertRowid } = db
      .prepare(
        "INSERT INTO accounts (name, created_at, set_up_at, language, made_by_plugin) VALUES (?, 0, 0, 'fr', 'club')"
      )
      .run('Famille Lambert')
    db.prepare(
      `INSERT INTO profiles (account_id, name, color, kind, position, created_at, role, user_id, tour_pending)
       VALUES (?, 'Claire', 'world', 'adult', 0, 0, 'admin', ?, 1)`
    ).run(Number(lastInsertRowid), claire.id)

    const login = await call('/login', '', 'POST', { email: 'claire@example.com', password: 'la phrase de Claire' })
    assert.equal(login.status, 204)
    const signedIn = cookiesFrom(login)
    const current = await call('/session', signedIn)
    assert.equal(current.status, 200)
    const body = (await current.json()) as { serverOnly?: boolean; profileChosen: boolean }
    assert.deepEqual([body.serverOnly ?? false, body.profileChosen], [false, true])
    const profiles = (await (await call('/profiles', signedIn)).json()) as { profiles: { name: string }[] }
    assert.deepEqual(
      profiles.profiles.map(profile => profile.name),
      ['Claire']
    )

    const anonymous = await call('/session', '')
    assert.equal(((await anonymous.json()) as { error: string }).error, 'unauthenticated')
  })
})
