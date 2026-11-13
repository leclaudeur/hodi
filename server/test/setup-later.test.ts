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
import { PluginHouseholdStore } from '../db/plugin-household-store.ts'
import { ProfileStore } from '../db/profile-store.ts'
import { ServerPeopleStore } from '../db/server-people-store.ts'
import { ServerSettingsStore } from '../db/server-settings-store.ts'
import { ServerStatsStore } from '../db/server-stats-store.ts'
import { SignInCodeStore } from '../db/sign-in-code-store.ts'
import { UserAccountStore } from '../db/user-account-store.ts'
import { UserDeviceStore } from '../db/user-device-store.ts'
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
  return { call, db, session: cookiesFrom(account), close: () => server.close() }
}

// « Aller à l'espace Serveur » once the server is set up: the server runs with its admin's account alone, in
// /server, until Serveur › Foyers brings the household steps back.
describe('a server whose household is left for later', () => {
  let call: Awaited<ReturnType<typeof startServer>>['call']
  let close: () => void
  let session = ''

  before(async () => {
    ;({ call, close, session } = await startServer())
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
    const people = (await (await call('/server/households', signedIn)).json()) as {
      households: unknown[]
      canCreate: boolean
    }
    assert.deepEqual([people.households, people.canCreate], [[], true])

    // Nothing of the app: there is no household to read in.
    const feed = await call('/profiles', signedIn)
    assert.equal(feed.status, 403)
    assert.equal(((await feed.json()) as { error: string }).error, 'no_household')
  })

  it('brings the household steps back from Serveur › Foyers, then works as any server', async () => {
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
    const people = (await (await call('/server/households', cookie)).json()) as {
      households: { name: string }[]
      canCreate: boolean
    }
    assert.deepEqual([people.households.map(entry => entry.name), people.canCreate], [['Chez nous'], false])
    assert.equal((await call('/server/households', cookie, 'POST')).status, 409)
  })
})

// « Créer un foyer » for someone else: the server's admin names it and its admin, and hands that person a code. The
// server's admin stays out of it, unless invited.
describe('a household made for someone else', () => {
  let call: Awaited<ReturnType<typeof startServer>>['call']
  let close: () => void
  let session = ''
  let code = ''

  before(async () => {
    ;({ call, close, session } = await startServer())
    assert.equal((await call('/setup/later', session, 'POST')).status, 204)
  })

  after(() => close())

  it('sets the household up with a profile that waits for its admin', async () => {
    const refused = await call('/server/households', session, 'POST', { for: 'other', name: 'Famille Dupont' })
    assert.equal(refused.status, 400)
    const made = await call('/server/households', session, 'POST', {
      for: 'other',
      name: 'Famille Dupont',
      admin: 'Claire',
      language: 'fr'
    })
    assert.equal(made.status, 201)
    const body = (await made.json()) as { profile: { name: string }; code: string; expiresAt: string }
    assert.equal(body.profile.name, 'Claire')
    assert.match(body.code, /^[A-HJKMNP-Z2-9]{8}$/)
    code = body.code

    // The server's admin has no profile in it: still /server alone.
    const current = (await (await call('/session', session)).json()) as { serverOnly?: boolean }
    assert.equal(current.serverOnly, true)
    assert.equal((await call('/profiles', session)).status, 403)
    const people = (await (await call('/server/households', session)).json()) as {
      households: { name: string }[]
      canCreate: boolean
    }
    assert.deepEqual([people.households.map(entry => entry.name), people.canCreate], [['Famille Dupont'], false])
    assert.equal((await call('/setup', '')).status, 200)
    const setup = (await (await call('/setup', '')).json()) as { needed: boolean; name: string }
    assert.deepEqual([setup.needed, setup.name], [false, 'Famille Dupont'])
  })

  it('makes its admin a new code, which replaces the first', async () => {
    const { households } = (await (await call('/server/households', session)).json()) as {
      households: { id: number }[]
    }
    const id = households[0]!.id
    assert.equal((await call(`/server/households/${id + 1}/admin-code`, session, 'POST')).status, 404)
    const remade = await call(`/server/households/${id}/admin-code`, session, 'POST')
    assert.equal(remade.status, 201)
    const body = (await remade.json()) as { profile: { name: string }; code: string }
    assert.equal(body.profile.name, 'Claire')
    assert.notEqual(body.code, code)
    const old = await call('/codes/join', '', 'POST', {
      email: 'x@example.com',
      password: PASSWORD,
      ageConfirmed: true,
      code
    })
    assert.notEqual(old.status, 200)
    code = body.code
  })

  it('lets its admin make an account with the code, and sign in to the household', async () => {
    const joined = await call('/codes/join', '', 'POST', {
      email: 'claire@example.com',
      password: PASSWORD,
      ageConfirmed: true,
      code
    })
    assert.equal(joined.status, 200)
    const cookie = cookiesFrom(joined)
    const current = (await (await call('/session', cookie)).json()) as { serverOnly?: boolean; profileChosen: boolean }
    assert.deepEqual([current.serverOnly, current.profileChosen], [undefined, true])
    const list = (await (await call('/profiles', cookie)).json()) as {
      profiles: { id: number; name: string; role: string }[]
      current: number
    }
    const opened = list.profiles.find(profile => profile.id === list.current)
    assert.deepEqual([opened?.name, opened?.role], ['Claire', 'admin'])

    // Claire has her account: no more code for her from the server.
    const { households } = (await (await call('/server/households', session)).json()) as {
      households: { id: number }[]
    }
    assert.equal((await call(`/server/households/${households[0]!.id}/admin-code`, session, 'POST')).status, 409)
  })
})

// « J'ai déjà un compte » on a code's page: the account that exists joins the household, without a second one.
describe('a code taken with an account that exists', () => {
  let call: Awaited<ReturnType<typeof startServer>>['call']
  let close: () => void
  let session = ''

  before(async () => {
    ;({ call, close, session } = await startServer())
    assert.equal((await call('/setup/later', session, 'POST')).status, 204)
  })

  after(() => close())

  it("brings the server's admin into a household that invited it", async () => {
    const made = (await (
      await call('/server/households', session, 'POST', { for: 'other', name: 'Famille Dupont', admin: 'Claire' })
    ).json()) as { code: string }
    const join = (body: Record<string, unknown>) =>
      call('/codes/join', '', 'POST', { existing: true, code: made.code, ...body })

    assert.equal((await join({ email: EMAIL })).status, 400)
    const wrong = await join({ email: EMAIL, password: 'pas le bon mot de passe' })
    assert.equal(wrong.status, 401)
    assert.equal(((await wrong.json()) as { error: string }).error, 'invalid_credentials')
    assert.equal((await join({ email: 'nobody@example.com', password: PASSWORD })).status, 401)

    const joined = await join({ email: EMAIL, password: PASSWORD })
    assert.equal(joined.status, 200)
    const cookie = cookiesFrom(joined)
    const list = (await (await call('/profiles', cookie)).json()) as {
      profiles: { id: number; name: string }[]
      current: number
    }
    assert.equal(list.profiles.find(profile => profile.id === list.current)?.name, 'Claire')
    // The same account on the device that made it: now in the household too.
    const before = (await (await call('/session', session)).json()) as { serverOnly?: boolean }
    assert.equal(before.serverOnly, undefined)
  })
})

// Village's case: the first household left for later, and a household a plugin made for someone else.
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
    new PluginHouseholdStore(db).create(
      { name: 'Famille Lambert', language: 'fr', plugin: 'village', admin: { name: 'Claire', accountId: claire.id } },
      0
    )

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
