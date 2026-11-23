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
import { ProfileStore } from '../db/profile-store.ts'
import { UserAccountStore } from '../db/user-account-store.ts'
import { UserDeviceStore } from '../db/user-device-store.ts'
import { parseCatalog } from '../news/catalog.ts'
import { NewsService } from '../news/news-service.ts'
import { fakeFetch } from './helpers/news.ts'

const ANTHO = { email: 'antho@example.com', password: 'le mot de passe d’Antho' }
const SOPHIE = { email: 'sophie@example.com', password: 'le mot de passe de Sophie' }
const FAST = { N: 2 ** 10, r: 8, p: 1 }

describe('an account whose profile was deleted from its household', () => {
  let baseUrl = ''
  let close = () => {}
  const clock = Date.UTC(2026, 10, 18, 12)
  const db = openDatabase(':memory:')
  const profiles = new ProfileStore(db)
  const accounts = new UserAccountStore(db)
  let sophieAccount = 0
  let maxId = 0
  let sophieDevice = ''

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
    new HouseholdStore(db).setUp({ name: 'Martin', timeZone: 'UTC', country: null, ai: null }, clock)
    const antho = accounts.createServerAdmin(ANTHO.email, await hashPassword(ANTHO.password, FAST), clock)!
    accounts.linkProfile(antho.id, 1)
    const sophie = profiles.create('Sophie', 'tech', clock)!
    sophieAccount = accounts.create(SOPHIE.email, await hashPassword(SOPHIE.password, FAST), clock)!.id
    accounts.linkProfile(sophieAccount, sophie.id)
    // A child's profile, which opens without a password: the one a device on nobody would fall into.
    maxId = profiles.create('Max', 'sport', clock, { kind: 'child' })!.id
    const catalog = parseCatalog('topics:\n  - id: world\n    label: Monde\n    sources: []\n')
    const server = createApp(config, {
      news: new NewsService(catalog, { fetchText: fakeFetch({}).fetchText, log: () => {} }),
      profiles,
      household: new HouseholdStore(db),
      accounts,
      devices: new UserDeviceStore(db),
      accountData: new AccountDataStore(db),
      now: () => clock
    }).listen(0)
    await new Promise(resolve => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    close = () => server.close()
    // The household's admin deletes her profile: her account stays.
    profiles.delete(sophie.id)
    sophieDevice = cookieOf(await call('POST', '/login', '', SOPHIE))
  })
  after(() => close())

  it('still signs in, and the session says it has no household', async () => {
    assert.ok(accounts.get(sophieAccount))
    assert.match(sophieDevice, /^hodi_session=/)
    const session = await call('GET', '/session', sophieDevice)
    assert.equal(session.status, 200)
    const body = (await session.json()) as { noHousehold?: boolean; profileChosen: boolean }
    assert.equal(body.noHousehold, true)
    assert.equal(body.profileChosen, false)
  })

  it('sees nothing of the household it left, nor opens any of its profiles', async () => {
    for (const route of ['/profiles', '/feed?tz=UTC', '/topics', `/profiles/${maxId}/photo`]) {
      const refused = await call('GET', route, sophieDevice)
      assert.deepEqual([route, refused.status, await refused.json()], [route, 423, { error: 'no_household' }])
    }
    const open = await call('PUT', '/profiles/current', sophieDevice, { id: maxId })
    assert.equal(open.status, 423)
    // Not even with a profile cookie from before.
    const withCookie = await call('GET', '/feed?tz=UTC', `${sophieDevice}; hodi_profile=${maxId}`)
    assert.equal(withCookie.status, 423)
  })

  it('reaches its own account: what deleting it takes, and a copy of its data', async () => {
    const account = await call('GET', '/account', sophieDevice)
    assert.equal(account.status, 200)
    const view = (await account.json()) as { email: string; deletion: { householdGoes: boolean; others: string[] } }
    assert.equal(view.email, SOPHIE.email)
    assert.deepEqual([view.deletion.householdGoes, view.deletion.others], [false, []])
    const copy = await call('GET', '/account/copy', sophieDevice)
    assert.equal(copy.status, 200)
    assert.match(copy.headers.get('content-disposition') ?? '', /attachment/)
  })

  it('deletes itself alone, the household and its profiles staying', async () => {
    const before = profiles.list().map(profile => profile.id)
    const deleted = await call('DELETE', '/account', sophieDevice, { password: SOPHIE.password })
    assert.equal(deleted.status, 204)
    assert.equal(accounts.get(sophieAccount), null)
    assert.deepEqual(
      profiles.list().map(profile => profile.id),
      before
    )
    assert.equal((await call('POST', '/login', '', SOPHIE)).status, 401)
  })
})

describe('the deletion plan of an account with no profile in the household', () => {
  it('never takes the household, even with no other adult account in it', async () => {
    const db = openDatabase(':memory:')
    const clock = Date.UTC(2026, 10, 18, 12)
    new HouseholdStore(db).setUp({ name: 'Martin', timeZone: 'UTC', country: null, ai: null }, clock)
    const accounts = new UserAccountStore(db)
    const profiles = new ProfileStore(db)
    const leftAlone = accounts.create(SOPHIE.email, await hashPassword(SOPHIE.password, FAST), clock)!
    const plan = deletionPlan(leftAlone, accounts, profiles, 'Martin')
    assert.deepEqual(plan, { householdGoes: false, household: 'Martin', profiles: [], heir: null, children: [] })
  })
})
