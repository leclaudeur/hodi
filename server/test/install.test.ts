import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { createApp } from '../app.ts'
import type { Config } from '../config.ts'
import { openDatabase } from '../db/database.ts'
import { HouseholdStore } from '../db/household-store.ts'
import { InstallStore } from '../db/install-store.ts'
import { migrate, versionBefore } from '../db/migrations.ts'
import { ProfileStore } from '../db/profile-store.ts'
import { ServerSettingsStore } from '../db/server-settings-store.ts'
import { UserAccountStore } from '../db/user-account-store.ts'
import { UserDeviceStore } from '../db/user-device-store.ts'
import { parseCatalog } from '../news/catalog.ts'
import { NewsService } from '../news/news-service.ts'
import { fakeFetch } from './helpers/news.ts'

const EMAIL = 'antho@example.com'
const PASSWORD = 'une phrase de passe assez longue'
const MIGRATION = 'CREATE TABLE server_install'

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
    install: new InstallStore(db),
    accounts: new UserAccountStore(db),
    devices: new UserDeviceStore(db),
    serverSettings: new ServerSettingsStore(db)
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

// The setup ends with the server admin's own profile: there is no « Plus tard » that leaves the server without one.
describe('the setup, to the end', () => {
  let env: Awaited<ReturnType<typeof startServer>>

  before(async () => {
    env = await startServer()
  })
  after(() => env.close())

  it('no longer goes on without a profile', async () => {
    // Nothing answers it any more: before the setup, only its own steps and /server do.
    const later = await env.call('/setup/later', env.session, 'POST')
    assert.deepEqual([later.status, await later.json()], [401, { error: 'setup_required' }])
    assert.equal((await env.call('/server/households', env.session, 'POST')).status, 404)
    const setup = (await (await env.call('/setup', env.session)).json()) as { needed: boolean; stage: string }
    assert.deepEqual([setup.needed, setup.stage], [true, 'household'])
  })

  it('is set up once the profile is made, in the language and clock chosen', async () => {
    const done = await env.call('/setup', env.session, 'POST', {
      profile: { name: 'Antho', color: 'tech' },
      timeZone: 'Europe/Brussels',
      country: 'BE',
      language: 'en',
      ai: null
    })
    assert.equal(done.status, 200)
    const { setUpAt, ...chosen } = new InstallStore(env.db).get()
    assert.equal(typeof setUpAt, 'number')
    assert.deepEqual(chosen, { language: 'en', timeZone: 'Europe/Brussels', hourCycle: 24 })
    const setup = (await (await env.call('/setup', '')).json()) as { needed: boolean; language: string }
    assert.deepEqual([setup.needed, setup.language], [false, 'en'])
  })
})

// A server whose setup went on without its admin's profile, as « Plus tard » left it: the profile comes at their next
// sign-in.
describe('a server set up without its admin’s profile', () => {
  let env: Awaited<ReturnType<typeof startServer>>

  before(async () => {
    env = await startServer()
    new InstallStore(env.db).setUp({ language: 'fr', timeZone: 'UTC' }, Date.now())
  })
  after(() => env.close())

  it('gives the admin their profile, named after their e-mail', async () => {
    const session = await env.call('/session', env.session)
    assert.equal(session.status, 200)
    const { profiles, serverAdmin } = (await (await env.call('/profiles', env.session)).json()) as {
      profiles: { name: string }[]
      serverAdmin: boolean
    }
    assert.deepEqual([profiles.map(profile => profile.name), serverAdmin], [['Antho'], true])
  })
})

describe('an install from before', () => {
  it('keeps its first household’s setup, language and clock', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db, versionBefore(MIGRATION))
    db.prepare(
      "UPDATE accounts SET name = 'Chez nous', set_up_at = 1000, language = 'en', time_zone = 'Europe/Paris', hour_cycle = 12"
    ).run()
    migrate(db)
    assert.deepEqual(new InstallStore(db).get(), {
      setUpAt: 1000,
      language: 'en',
      timeZone: 'Europe/Paris',
      hourCycle: 12
    })
    assert.equal((db.prepare('SELECT name FROM accounts WHERE id = 1').get() as { name: string }).name, 'Chez nous')
  })

  it('counts as set up when its setup went on without a household, and forgets that choice', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db, versionBefore(MIGRATION))
    db.prepare("INSERT INTO server_settings (key, value) VALUES ('householdLater', 1)").run()
    migrate(db)
    assert.equal(new InstallStore(db).isSetUp(), true)
    assert.equal(db.prepare("SELECT 1 FROM server_settings WHERE key = 'householdLater'").get(), undefined)
  })

  it('waits for its first-run screens when it never had any', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db, versionBefore(MIGRATION))
    migrate(db)
    assert.equal(new InstallStore(db).isSetUp(), false)
    assert.equal((db.prepare('SELECT name FROM accounts WHERE id = 1').get() as { name: string }).name, 'Hodi')
  })
})
