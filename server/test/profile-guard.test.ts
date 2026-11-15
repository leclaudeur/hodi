import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, before, describe, it } from 'node:test'
import { createApp } from '../app.ts'
import { hashPassword, verifyPassword } from '../auth/password.ts'
import type { Config } from '../config.ts'
import { openDatabase } from '../db/database.ts'
import { HouseholdStore } from '../db/household-store.ts'
import { migrate, versionBefore } from '../db/migrations.ts'
import { ProfileStore } from '../db/profile-store.ts'
import { UserAccountStore } from '../db/user-account-store.ts'
import { UserDeviceStore } from '../db/user-device-store.ts'
import { parseCatalog } from '../news/catalog.ts'
import { NewsService } from '../news/news-service.ts'
import { fakeFetch } from './helpers/news.ts'

const ANTHO = { email: 'antho@example.com', password: 'le mot de passe d’Antho' }
const SOPHIE = { email: 'sophie@example.com', password: 'le mot de passe de Sophie' }
const FAST = { N: 2 ** 10, r: 8, p: 1 }

describe('opening a profile with its account’s password', () => {
  let baseUrl = ''
  let close = () => {}
  let clock = Date.UTC(2026, 10, 6, 12)
  const db = openDatabase(':memory:')
  const profiles = new ProfileStore(db)
  const accounts = new UserAccountStore(db)
  let sophieId = 0
  let noAccountId = 0
  let maxId = 0
  // Each person's device, signed in with their account.
  let anthoDevice = ''
  let sophieDevice = ''

  const call = (method: string, route: string, cookie: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(`${baseUrl}/api${route}`, {
      method,
      headers: { cookie, 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  const cookieOf = (response: Response) => (response.headers.get('set-cookie') ?? '').split(';')[0]
  // Every cookie a response sets, as one Cookie header.
  const cookiesOf = (response: Response) =>
    response.headers
      .getSetCookie()
      .map(cookie => cookie.split(';')[0])
      .join('; ')
  const signIn = async (account: { email: string; password: string }) =>
    cookieOf(await call('POST', '/login', '', account))
  const list = async (cookie: string) =>
    (await (await call('GET', '/profiles', cookie)).json()) as {
      profiles: { id: number; locked: boolean }[]
      own: number | null
    }
  const lockedIds = async (cookie: string) =>
    (await list(cookie)).profiles.filter(profile => profile.locked).map(profile => profile.id)
  const chosen = async (cookie: string) =>
    ((await (await call('GET', '/session', cookie)).json()) as { profileChosen: boolean }).profileChosen

  before(async () => {
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
    new HouseholdStore(db).setUp({ name: 'Martin', timeZone: 'UTC', country: null, ai: null }, clock)
    const antho = accounts.createServerAdmin(ANTHO.email, await hashPassword(ANTHO.password, FAST), clock)!
    accounts.linkProfile(antho.id, 1)
    const sophie = profiles.create('Sophie', 'tech', clock)!
    sophieId = sophie.id
    accounts.linkProfile(accounts.create(SOPHIE.email, await hashPassword(SOPHIE.password, FAST), clock)!.id, sophieId)
    noAccountId = profiles.create('Mamie', 'world', clock)!.id
    const catalog = parseCatalog('topics:\n  - id: world\n    label: Monde\n    sources: []\n')
    const server = createApp(config, {
      news: new NewsService(catalog, { fetchText: fakeFetch({}).fetchText, log: () => {} }),
      profiles,
      household: new HouseholdStore(db),
      accounts,
      devices: new UserDeviceStore(db),
      now: () => clock
    }).listen(0)
    await new Promise(resolve => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    close = () => server.close()
    anthoDevice = await signIn(ANTHO)
    sophieDevice = await signIn(SOPHIE)
  })
  after(() => close())

  it('asks every adult for its own password, on every device, and never the young', async () => {
    assert.deepEqual(await lockedIds(anthoDevice), [1, sophieId, noAccountId])
    assert.deepEqual(await lockedIds(sophieDevice), [1, sophieId, noAccountId])

    // His own profile too, on his own device.
    const refused = await call('PUT', '/profiles/current', anthoDevice, { id: 1 })
    assert.equal(refused.status, 403)
    assert.deepEqual(await refused.json(), { error: 'wrong_password' })
    assert.equal((await call('PUT', '/profiles/current', anthoDevice, { id: 1, password: ANTHO.password })).status, 200)

    // Another adult's only with that person's password.
    assert.equal(
      (await call('PUT', '/profiles/current', anthoDevice, { id: sophieId, password: ANTHO.password })).status,
      403
    )
    const opened = await call('PUT', '/profiles/current', anthoDevice, { id: sophieId, password: SOPHIE.password })
    assert.equal(opened.status, 200)
    assert.equal(await chosen(`${anthoDevice}; ${cookieOf(opened)}`), true)
    // A plain cookie for her profile does not open it.
    assert.equal(await chosen(`${anthoDevice}; hodi_profile=${sophieId}`), false)

    // An adult without an account stays closed, whatever is typed.
    const closed = await call('PUT', '/profiles/current', anthoDevice, { id: noAccountId, password: ANTHO.password })
    assert.equal(closed.status, 403)
    assert.deepEqual(await closed.json(), { error: 'no_account' })

    // A young profile opens without anything.
    const asAntho = cookiesOf(await call('PUT', '/profiles/current', anthoDevice, { id: 1, password: ANTHO.password }))
    const max = await call('POST', '/profiles', `${anthoDevice}; ${asAntho}`, {
      name: 'Max',
      color: 'sport',
      kind: 'child'
    })
    maxId = ((await max.json()) as { id: number }).id
    assert.deepEqual(await lockedIds(anthoDevice), [1, sophieId, noAccountId])
    assert.equal((await call('PUT', '/profiles/current', anthoDevice, { id: maxId })).status, 200)
  })

  it('signs the device in with the account whose profile opens there', async () => {
    assert.equal((await list(anthoDevice)).own, 1)
    const opened = await call('PUT', '/profiles/current', anthoDevice, { id: sophieId, password: SOPHIE.password })
    const asSophie = cookiesOf(opened)
    assert.equal((await list(asSophie)).own, sophieId)
    // Signing in opens one's own profile at once.
    assert.equal(await chosen(`${sophieDevice}`), false)
    const login = await call('POST', '/login', '', SOPHIE)
    assert.equal(await chosen(cookiesOf(login)), true)
  })

  it('hashes a password made with weaker settings again, at sign-in or when its profile opens', async () => {
    const strong = /^scrypt:32768:8:3:/
    // Both signed in before this test, with hashes made with FAST: they are hashed again, and the date stays.
    const sophie = accounts.byEmail(SOPHIE.email)!
    assert.match(sophie.passwordHash, strong)
    assert.equal(sophie.passwordChangedAt, clock)
    assert.equal(await verifyPassword(SOPHIE.password, sophie.passwordHash), true)

    const antho = accounts.byEmail(ANTHO.email)!
    accounts.upgradePassword(antho.id, await hashPassword(ANTHO.password, FAST))
    const opened = await call('PUT', '/profiles/current', anthoDevice, { id: 1, password: ANTHO.password })
    assert.equal(opened.status, 200)
    assert.match(accounts.byEmail(ANTHO.email)!.passwordHash, strong)
    // The same password: every device stays signed in.
    assert.equal((await call('GET', '/profiles', anthoDevice)).status, 200)
    assert.equal((await call('GET', '/profiles', sophieDevice)).status, 200)
  })

  it('leaves the profile when the app opens again, for « Qui lit ? »', async () => {
    const opened = await call('PUT', '/profiles/current', anthoDevice, { id: 1, password: ANTHO.password })
    const asAntho = `${anthoDevice}; ${cookieOf(opened)}`
    assert.equal(await chosen(asAntho), true)
    const left = await call('DELETE', '/profiles/current', asAntho)
    assert.equal(left.status, 204)
    assert.equal(await chosen(`${anthoDevice}; ${cookieOf(left)}`), false)
  })

  it('asks again on every device once the account has a new password', async () => {
    const opened = await call('PUT', '/profiles/current', anthoDevice, { id: sophieId, password: SOPHIE.password })
    const asSophie = `${anthoDevice}; ${cookieOf(opened)}`
    accounts.revokeSessions(accounts.ofProfile(sophieId)!.id)
    assert.equal(await chosen(asSophie), false)
    sophieDevice = await signIn(SOPHIE)
  })

  it('stops guessing after a few wrong passwords, on that device only', async () => {
    clock += 16 * 60_000
    const statuses = []
    for (let attempt = 0; attempt < 6; attempt++) {
      statuses.push((await call('PUT', '/profiles/current', anthoDevice, { id: sophieId, password: 'faux' })).status)
    }
    assert.deepEqual(statuses, [403, 403, 403, 403, 403, 429])
    assert.equal(
      (await call('PUT', '/profiles/current', anthoDevice, { id: sophieId, password: SOPHIE.password })).status,
      429
    )
    // Another device, behind the same proxy, still opens it.
    const elsewhere = await call(
      'PUT',
      '/profiles/current',
      anthoDevice,
      { id: sophieId, password: SOPHIE.password },
      { 'X-Forwarded-For': '192.168.1.20' }
    )
    assert.equal(elsewhere.status, 200)
  })
})

describe('the four-digit codes, from before', () => {
  it('go, the Code parental with them, and every device chooses again', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db, versionBefore('UPDATE profiles SET pin_hash = NULL'))
    db.prepare("UPDATE accounts SET parental_pin_hash = 'hash'").run()
    db.prepare("UPDATE profiles SET pin_hash = 'hash'").run()
    const version = (db.prepare('SELECT parental_pin_version AS v FROM accounts').get() as { v: number }).v
    migrate(db)
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS n FROM profiles WHERE pin_hash IS NOT NULL').get() as { n: number }).n,
      0
    )
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS n FROM accounts WHERE parental_pin_hash IS NOT NULL').get() as { n: number }).n,
      0
    )
    assert.equal((db.prepare('SELECT parental_pin_version AS v FROM accounts').get() as { v: number }).v, version + 1)
  })
})
