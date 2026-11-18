import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, before, describe, it } from 'node:test'
import { createApp } from '../app.ts'
import { LoginThrottle } from '../auth/login-throttle.ts'
import { hashPassword } from '../auth/password.ts'
import type { Config } from '../config.ts'
import { AccountDataStore } from '../db/account-data.ts'
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
const CODE = '482913'

// « Qui lit ? » with « Profil privé », the household's Code parental and « Ne plus demander sur cet appareil »: the
// Martin family: Antho the admin (his profile still named Admin), Sophie, and Max (8).
describe('opening a profile with a private profile, a Code parental or a trusted device', () => {
  let baseUrl = ''
  let close = () => {}
  let clock = Date.UTC(2026, 10, 18, 12)
  const db = openDatabase(':memory:')
  const profiles = new ProfileStore(db)
  const accounts = new UserAccountStore(db)
  const devices = new UserDeviceStore(db)
  let sophieId = 0
  let maxId = 0
  // Antho's own device, his profile open; the household's tablet, signed in with his account, nobody's open.
  let anthoPhone = ''
  let tablet = ''

  const call = (method: string, route: string, cookie: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(`${baseUrl}/api${route}`, {
      method,
      headers: { cookie, 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  // The cookies a browser holds after a response: the ones it set replace those of the same name.
  const after_ = (cookie: string, response: Response) => {
    const jar = new Map(cookie.split('; ').map(part => [part.split('=')[0]!, part] as const))
    for (const set of response.headers.getSetCookie()) {
      const part = set.split(';')[0]!
      const name = part.split('=')[0]!
      if (/Max-Age=0/.test(set)) jar.delete(name)
      else jar.set(name, part)
    }
    return [...jar.values()].filter(Boolean).join('; ')
  }
  const locks = async (cookie: string) =>
    Object.fromEntries(
      (
        (await (await call('GET', '/profiles', cookie)).json()) as {
          profiles: { name: string; lock?: string }[]
        }
      ).profiles.map(profile => [profile.name, profile.lock ?? null])
    )
  const chosen = async (cookie: string) =>
    ((await (await call('GET', '/session', cookie)).json()) as { profileChosen: boolean }).profileChosen
  const signIn = async (account: { email: string; password: string }) =>
    after_('', await call('POST', '/login', '', account))

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
    sophieId = profiles.create('Sophie', 'tech', clock)!.id
    accounts.linkProfile(accounts.create(SOPHIE.email, await hashPassword(SOPHIE.password, FAST), clock)!.id, sophieId)
    maxId = profiles.create('Max', 'sport', clock, { kind: 'child' })!.id
    const catalog = parseCatalog('topics:\n  - id: world\n    label: Monde\n    sources: []\n')
    const server = createApp(config, {
      news: new NewsService(catalog, { fetchText: fakeFetch({}).fetchText, log: () => {} }),
      profiles,
      household: new HouseholdStore(db),
      accounts,
      devices,
      accountData: new AccountDataStore(db),
      now: () => clock,
      pinThrottle: new LoginThrottle(5, undefined, 50)
    }).listen(0)
    await new Promise(resolve => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    close = () => server.close()
    anthoPhone = await signIn(ANTHO)
    tablet = after_(await signIn(ANTHO), await call('DELETE', '/profiles/current', await signIn(ANTHO)))
  })
  after(() => close())

  it('opens every profile at once by default', async () => {
    assert.deepEqual(await locks(tablet), { Admin: null, Sophie: null, Max: null })
    const opened = await call('PUT', '/profiles/current', tablet, { id: sophieId })
    assert.equal(opened.status, 200)
    assert.equal(await chosen(after_(tablet, opened)), true)
  })

  it('lets the admin alone set the Code parental, six digits, never shown again', async () => {
    const asSophie = after_(tablet, await call('PUT', '/profiles/current', tablet, { id: sophieId }))
    assert.equal((await call('PUT', '/household/parental-code', asSophie, { code: CODE })).status, 403)
    assert.equal((await call('PUT', '/household/parental-code', anthoPhone, { code: '1234' })).status, 400)
    assert.equal((await call('PUT', '/household/parental-code', anthoPhone, { code: '12345a' })).status, 400)
    const set = await call('PUT', '/household/parental-code', anthoPhone, { code: CODE })
    assert.equal(set.status, 200)
    const view = (await set.json()) as Record<string, unknown>
    assert.equal(view.parentalCode, true)
    assert.ok(!JSON.stringify(view).includes(CODE))
    // Her profile was open on the tablet, his on his phone: the new code is asked from now on.
    assert.equal(await chosen(asSophie), false)
    assert.equal(await chosen(anthoPhone), false)
    anthoPhone = after_(anthoPhone, await call('PUT', '/profiles/current', anthoPhone, { id: 1, code: CODE }))
  })

  it('asks the code for the adults, never for the young', async () => {
    assert.deepEqual(await locks(tablet), { Admin: 'code', Sophie: 'code', Max: null })
    const wrong = await call('PUT', '/profiles/current', tablet, { id: sophieId, code: '000000' })
    assert.deepEqual([wrong.status, await wrong.json()], [403, { error: 'wrong_code' }])
    // Her password is no way around it.
    assert.equal(
      (await call('PUT', '/profiles/current', tablet, { id: sophieId, password: SOPHIE.password })).status,
      403
    )
    const opened = await call('PUT', '/profiles/current', tablet, { id: sophieId, code: CODE })
    assert.equal(opened.status, 200)
    assert.equal(await chosen(after_(tablet, opened)), true)
    assert.equal((await call('PUT', '/profiles/current', tablet, { id: maxId })).status, 200)
  })

  it('stops guessing the code after a few tries, on that device only', async () => {
    // The wrong code and password above counted: a new window.
    clock += 16 * 60_000
    const statuses = []
    for (let attempt = 0; attempt < 6; attempt++) {
      statuses.push((await call('PUT', '/profiles/current', tablet, { id: 1, code: '111111' })).status)
    }
    assert.deepEqual(statuses, [403, 403, 403, 403, 403, 429])
    const elsewhere = { 'X-Forwarded-For': '192.168.1.30' }
    assert.equal((await call('PUT', '/profiles/current', tablet, { id: 1, code: CODE }, elsewhere)).status, 200)
    clock += 16 * 60_000
  })

  it('asks a private profile for its password instead, the Code parental never opens it', async () => {
    // Turning it on asks for the password it will need.
    assert.equal((await call('PUT', '/account/private', anthoPhone, { on: true })).status, 403)
    assert.equal((await call('PUT', '/account/private', anthoPhone, { on: true, password: 'faux' })).status, 403)
    const on = await call('PUT', '/account/private', anthoPhone, { on: true, password: ANTHO.password })
    assert.equal(on.status, 200)
    assert.equal(((await on.json()) as { privateProfile: boolean }).privateProfile, true)
    // His profile, open on his phone, asks again there too.
    assert.equal(await chosen(anthoPhone), false)

    assert.deepEqual(await locks(tablet), { Admin: 'password', Sophie: 'code', Max: null })
    assert.equal((await call('PUT', '/profiles/current', tablet, { id: 1, code: CODE })).status, 403)
    const opened = await call('PUT', '/profiles/current', tablet, { id: 1, password: ANTHO.password })
    assert.equal(opened.status, 200)
    anthoPhone = after_(
      anthoPhone,
      await call('PUT', '/profiles/current', anthoPhone, { id: 1, password: ANTHO.password })
    )
  })

  it('opens it without the password on the devices its person trusts, and only there', async () => {
    // The tablet is now Sophie's for a moment, then Antho trusts it.
    const sophieTablet = after_(tablet, await call('PUT', '/profiles/current', tablet, { id: sophieId, code: CODE }))
    const trusted = await call('PUT', '/profiles/current', sophieTablet, {
      id: 1,
      password: ANTHO.password,
      trust: true
    })
    assert.equal(trusted.status, 200)
    tablet = after_(sophieTablet, trusted)
    assert.match(tablet, /hodi_trusted=v3\./)
    assert.deepEqual(await locks(tablet), { Admin: null, Sophie: 'code', Max: null })

    // Next time, Max on it: Antho's opens at once, on this tablet and nowhere else.
    tablet = after_(tablet, await call('PUT', '/profiles/current', tablet, { id: maxId }))
    const again = await call('PUT', '/profiles/current', tablet, { id: 1 })
    assert.equal(again.status, 200)
    tablet = after_(tablet, again)
    assert.equal(await chosen(tablet), true)
    const phoneOnly = after_(anthoPhone, await call('DELETE', '/profiles/current', anthoPhone))
    assert.equal((await locks(phoneOnly)).Admin, 'password')
    assert.equal((await call('PUT', '/profiles/current', phoneOnly, { id: 1 })).status, 403)

    // A trust cookie made up for his account opens nothing.
    const forged = `${phoneOnly}; hodi_trusted=v3.1.1.9999999999.forged`
    assert.equal((await call('PUT', '/profiles/current', forged, { id: 1 })).status, 403)

    const view = (await (await call('GET', '/account', anthoPhone)).json()) as {
      devices: { trusted: boolean; current: boolean }[]
    }
    assert.equal(view.devices.filter(device => device.trusted).length, 1)
  })

  it('asks again everywhere after « Redemander », and on a device that signs out', async () => {
    const asked = await call('DELETE', '/account/trusted', anthoPhone)
    assert.equal(asked.status, 200)
    const view = (await asked.json()) as { devices: { trusted: boolean }[] }
    assert.equal(view.devices.filter(device => device.trusted).length, 0)
    assert.equal((await locks(tablet)).Admin, 'password')

    // Trusted again, then the tablet signs out: the trust goes with it.
    tablet = after_(
      tablet,
      await call('PUT', '/profiles/current', tablet, { id: 1, password: ANTHO.password, trust: true })
    )
    assert.equal((await locks(tablet)).Admin, null)
    const out = await call('POST', '/logout', tablet)
    assert.match(out.headers.getSetCookie().join('\n'), /hodi_trusted=; Max-Age=0/)
    const signedInAgain = after_(after_(tablet, out), await call('POST', '/login', '', SOPHIE))
    assert.equal((await locks(signedInAgain)).Admin, 'password')
    // Even a copy of the old cookie: the device's row is no longer trusted.
    assert.equal(
      (await locks(`${signedInAgain}; ${tablet.split('; ').find(part => part.startsWith('hodi_trusted='))}`)).Admin,
      'password'
    )
  })

  it('opens freely again once private is off and the code is gone', async () => {
    assert.equal((await call('PUT', '/account/private', anthoPhone, { on: false })).status, 200)
    const removed = await call('DELETE', '/household/parental-code', anthoPhone)
    assert.equal(((await removed.json()) as { parentalCode: boolean }).parentalCode, false)
    assert.deepEqual(await locks(tablet), { Admin: null, Sophie: null, Max: null })
  })
})

describe('the accounts from before « Profil privé »', () => {
  it('keep asking for their password, and no device is trusted', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db, versionBefore('ADD COLUMN private_profile'))
    db.prepare(
      "INSERT INTO users (email, password_hash, password_changed_at, created_at) VALUES ('a@example.com', 'h', 0, 0)"
    ).run()
    migrate(db)
    assert.deepEqual({ ...db.prepare('SELECT private_profile FROM users').get() }, { private_profile: 1 })
  })
})
