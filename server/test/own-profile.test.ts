import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { createApp } from '../app.ts'
import { hashPassword } from '../auth/password.ts'
import type { Config } from '../config.ts'
import { AccountDataStore, deletionPlan } from '../db/account-data.ts'
import { openDatabase } from '../db/database.ts'
import { HouseholdStore } from '../db/household-store.ts'
import { InstallStore } from '../db/install-store.ts'
import { ProfileStore } from '../db/profile-store.ts'
import { UserAccountStore } from '../db/user-account-store.ts'
import { UserDeviceStore } from '../db/user-device-store.ts'
import { parseCatalog } from '../news/catalog.ts'
import { NewsService } from '../news/news-service.ts'
import { fakeFetch } from './helpers/news.ts'

const ANTHO = { email: 'antho@example.com', password: 'le mot de passe d’Antho' }
const SOPHIE = { email: 'sophie@example.com', password: 'le mot de passe de Sophie' }
const FAST = { N: 2 ** 10, r: 8, p: 1 }

describe('an account with no profile', () => {
  let baseUrl = ''
  let close = () => {}
  const clock = Date.UTC(2026, 10, 18, 12)
  const db = openDatabase(':memory:')
  const profiles = new ProfileStore(db)
  const accounts = new UserAccountStore(db)
  let sophieAccount = 0

  const call = (method: string, route: string, cookie: string, body?: unknown) =>
    fetch(`${baseUrl}/api${route}`, {
      method,
      headers: { cookie, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  const cookieOf = (response: Response) => (response.headers.get('set-cookie') ?? '').split(';')[0]

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
    new InstallStore(db).setUp({ language: 'fr', timeZone: 'UTC' }, clock)
    const antho = accounts.createServerAdmin(ANTHO.email, await hashPassword(ANTHO.password, FAST), clock)!
    accounts.linkProfile(antho.id, 1)
    const sophie = profiles.create('Sophie', 'tech', clock)!
    sophieAccount = accounts.create(SOPHIE.email, await hashPassword(SOPHIE.password, FAST), clock)!.id
    accounts.linkProfile(sophieAccount, sophie.id)
    const catalog = parseCatalog('topics:\n  - id: world\n    label: Monde\n    sources: []\n')
    const server = createApp(config, {
      news: new NewsService(catalog, { fetchText: fakeFetch({}).fetchText, log: () => {} }),
      profiles,
      household: new HouseholdStore(db),
      install: new InstallStore(db),
      accounts,
      devices: new UserDeviceStore(db),
      accountData: new AccountDataStore(db),
      now: () => clock
    }).listen(0)
    await new Promise(resolve => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    close = () => server.close()
    // Her profile is deleted: her account stays, still wearing its name and colour.
    profiles.delete(sophie.id)
  })
  after(() => close())

  it('gets back a profile of its own as it signs in, named and coloured as it was', async () => {
    const device = cookieOf(await call('POST', '/login', '', SOPHIE))
    assert.match(device, /^hodi_session=/)
    const session = await call('GET', '/session', device)
    assert.equal(session.status, 200)
    assert.equal(((await session.json()) as Record<string, unknown>).noHousehold, undefined)
    const own = accounts.profileOf(sophieAccount, 1)
    assert.notEqual(own, null)
    assert.deepEqual(
      [profiles.get(own!)?.name, profiles.get(own!)?.color, profiles.get(own!)?.kind],
      ['Sophie', 'tech', 'adult']
    )
    // Once: the next requests make no other.
    assert.equal((await call('GET', '/profiles', device)).status, 200)
    assert.equal(profiles.list().filter(profile => profile.name === 'Sophie').length, 1)
  })

  it('makes one profile only, however many requests come at once', async () => {
    const made = accounts.create('paul@example.com', await hashPassword(SOPHIE.password, FAST), clock)!
    const device = cookieOf(await call('POST', '/login', '', { email: made.email, password: SOPHIE.password }))
    const answers = await Promise.all(
      ['/session', '/profiles', '/topics', '/session', '/profiles'].map(route => call('GET', route, device))
    )
    assert.deepEqual(
      answers.map(answer => answer.status),
      [200, 200, 200, 200, 200]
    )
    assert.equal(profiles.list().filter(profile => profile.name === 'Paul').length, 1)
  })

  it('names the profile of an account a plugin made after its e-mail', async () => {
    const made = accounts.create('marie.dupont@example.com', await hashPassword(SOPHIE.password, FAST), clock)!
    const device = cookieOf(await call('POST', '/login', '', { email: made.email, password: SOPHIE.password }))
    assert.equal((await call('GET', '/session', device)).status, 200)
    const own = accounts.profileOf(made.id, 1)
    assert.deepEqual([profiles.get(own!)?.name, profiles.get(own!)?.color], ['Marie dupont', 'world'])
  })
})

describe('the deletion plan of an account with no profile', () => {
  it('never takes the server, even with no other adult account on it', async () => {
    const db = openDatabase(':memory:')
    const clock = Date.UTC(2026, 10, 18, 12)
    new InstallStore(db).setUp({ language: 'fr', timeZone: 'UTC' }, clock)
    const accounts = new UserAccountStore(db)
    const profiles = new ProfileStore(db)
    const leftAlone = accounts.create(SOPHIE.email, await hashPassword(SOPHIE.password, FAST), clock)!
    const plan = deletionPlan(leftAlone, accounts, profiles)
    assert.deepEqual(plan, { serverGoes: false, handOverFirst: false, profiles: [], children: [] })
  })
})
