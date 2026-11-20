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
const MAX = { email: '@max', password: 'le mot de passe de Max' }
const CODE = '482913'
const SOPHIE_CODE = '715206'

// « Qui lit ? » with « Profil privé », each parent's Code parental and « Ne plus demander sur cet appareil »: the
// Martin family: Antho the admin (his profile still named Admin), Sophie, and their son Max (8), who signs in on the
// family tablet with his own account.
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
  // Antho's own phone and Sophie's laptop, their profiles open; the family tablet, signed in with all three accounts,
  // nobody's open.
  let anthoPhone = ''
  let sophieLaptop = ''
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
  const signIn = async (account: { email: string; password: string }, device = '') =>
    after_(device, await call('POST', '/login', device, account))

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
    const sophie = accounts.create(SOPHIE.email, await hashPassword(SOPHIE.password, FAST), clock)!
    accounts.linkProfile(sophie.id, sophieId)
    const passwordHash = await hashPassword(MAX.password, FAST)
    const max = accounts.young.create(
      profiles,
      antho.id,
      { name: 'Max', color: 'sport', kind: 'child', handle: 'max', passwordHash },
      clock
    )!
    maxId = max.profileId
    db.prepare('INSERT INTO account_parents (child_id, parent_id, created_at) VALUES (?, ?, ?)').run(
      max.accountId,
      sophie.id,
      clock
    )
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
    sophieLaptop = await signIn(SOPHIE)
    // The tablet all three signed in on, back on « Qui lit ? ».
    const all = await signIn(MAX, await signIn(SOPHIE, await signIn(ANTHO)))
    tablet = after_(all, await call('DELETE', '/profiles/current', all))
  })
  after(() => close())

  it('opens every profile at once by default', async () => {
    assert.deepEqual(await locks(tablet), { Admin: null, Sophie: null, Max: null })
    const opened = await call('PUT', '/profiles/current', tablet, { id: sophieId })
    assert.equal(opened.status, 200)
    assert.equal(await chosen(after_(tablet, opened)), true)
  })

  it('lets each parent set their own Code parental, six digits, never shown again', async () => {
    // Only a parent's profile is asked for one, and a young account changes nothing of its own.
    assert.equal((await call('PUT', '/account/parental-code', await signIn(MAX), { code: CODE })).status, 403)
    assert.equal((await call('PUT', '/account/parental-code', anthoPhone, { code: '1234' })).status, 400)
    assert.equal((await call('PUT', '/account/parental-code', anthoPhone, { code: '12345a' })).status, 400)
    // His own password first: a profile left open on a shared device does not prove who changes it.
    assert.equal((await call('PUT', '/account/parental-code', anthoPhone, { code: CODE })).status, 403)
    const wrong = { code: CODE, password: 'faux' }
    assert.equal((await call('PUT', '/account/parental-code', anthoPhone, wrong)).status, 403)
    const set = await call('PUT', '/account/parental-code', anthoPhone, { code: CODE, password: ANTHO.password })
    assert.equal(set.status, 200)
    const view = (await set.json()) as Record<string, unknown>
    assert.equal(view.parentalCode, true)
    assert.ok(!JSON.stringify(view).includes(CODE))
    // No young account on his phone: it never asks there.
    anthoPhone = after_(anthoPhone, set)
    assert.equal(await chosen(anthoPhone), true)
    const hers = { code: SOPHIE_CODE, password: SOPHIE.password }
    sophieLaptop = after_(sophieLaptop, await call('PUT', '/account/parental-code', sophieLaptop, hers))
    assert.deepEqual(await locks(tablet), { Admin: 'code', Sophie: 'code', Max: null })
  })

  it('asks each parent their own code where a young account is signed in, never for the young', async () => {
    const theirs = await call('PUT', '/profiles/current', tablet, { id: sophieId, code: CODE })
    assert.deepEqual([theirs.status, await theirs.json()], [403, { error: 'wrong_code' }])
    const opened = await call('PUT', '/profiles/current', tablet, { id: sophieId, code: SOPHIE_CODE })
    assert.equal(opened.status, 200)
    assert.equal(await chosen(after_(tablet, opened)), true)
    assert.equal((await call('PUT', '/profiles/current', tablet, { id: maxId })).status, 200)
    // The parents' own laptop, where Max never signed in.
    const laptop = await signIn(ANTHO, sophieLaptop)
    const shared = after_(laptop, await call('DELETE', '/profiles/current', laptop))
    assert.deepEqual(await locks(shared), { Admin: null, Sophie: null, Max: null })
  })

  it('opens with the parent’s password when the code is forgotten', async () => {
    const wrong = await call('PUT', '/profiles/current', tablet, { id: sophieId, password: 'faux' })
    assert.deepEqual([wrong.status, await wrong.json()], [403, { error: 'wrong_password' }])
    // Never someone else's password.
    assert.equal(
      (await call('PUT', '/profiles/current', tablet, { id: sophieId, password: ANTHO.password })).status,
      403
    )
    const opened = await call('PUT', '/profiles/current', tablet, { id: sophieId, password: SOPHIE.password })
    assert.equal(opened.status, 200)
    assert.equal(await chosen(after_(tablet, opened)), true)
  })

  it('keeps asking on the tablet once the teen signs out of it', async () => {
    const asMax = after_(tablet, await call('PUT', '/profiles/current', tablet, { id: maxId }))
    const left = after_(asMax, await call('POST', '/logout', asMax))
    assert.deepEqual(await locks(left), { Admin: 'code', Sophie: 'code', Max: null })
    const free = await call('PUT', '/profiles/current', left, { id: sophieId })
    assert.deepEqual([free.status, await free.json()], [403, { error: 'wrong_code' }])
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
    const tabletAsAntho = after_(tablet, await call('PUT', '/profiles/current', tablet, { id: 1, code: CODE }))
    assert.equal(await chosen(tabletAsAntho), true)
    // Turning it on asks for the password it will need.
    assert.equal((await call('PUT', '/account/private', anthoPhone, { on: true })).status, 403)
    assert.equal((await call('PUT', '/account/private', anthoPhone, { on: true, password: 'faux' })).status, 403)
    const on = await call('PUT', '/account/private', anthoPhone, { on: true, password: ANTHO.password })
    assert.equal(on.status, 200)
    assert.equal(((await on.json()) as { privateProfile: boolean }).privateProfile, true)
    // His profile stays open on the phone that turned it on, and asks for the password on the tablet.
    assert.equal(await chosen(after_(anthoPhone, on)), true)
    assert.equal(await chosen(tabletAsAntho), false)

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
    const sophieTablet = after_(
      tablet,
      await call('PUT', '/profiles/current', tablet, { id: sophieId, code: SOPHIE_CODE })
    )
    const trusted = await call('PUT', '/profiles/current', sophieTablet, {
      id: 1,
      password: ANTHO.password,
      trust: true
    })
    assert.equal(trusted.status, 200)
    tablet = after_(sophieTablet, trusted)
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

    // Trusted again, then he signs out of the tablet: the trust goes with his session there.
    tablet = after_(
      tablet,
      await call('PUT', '/profiles/current', tablet, { id: 1, password: ANTHO.password, trust: true })
    )
    assert.equal((await locks(tablet)).Admin, null)
    const out = await call('POST', '/logout', tablet)
    tablet = after_(tablet, out)
    assert.equal((await locks(tablet)).Admin, 'password')
    // Signed in on it again, it asks again.
    tablet = await signIn(ANTHO, tablet)
    assert.equal((await locks(tablet)).Admin, 'password')
  })

  it('opens freely again once private is off and the code is gone', async () => {
    const off = await call('PUT', '/account/private', anthoPhone, { on: false })
    assert.equal(off.status, 200)
    // His profile stays open on the phone, now that the Code parental would open it.
    anthoPhone = after_(anthoPhone, off)
    assert.equal(await chosen(anthoPhone), true)
    assert.equal((await call('DELETE', '/account/parental-code', anthoPhone)).status, 403)
    const removed = await call('DELETE', '/account/parental-code', anthoPhone, { password: ANTHO.password })
    assert.equal(((await removed.json()) as { parentalCode: boolean }).parentalCode, false)
    assert.deepEqual(await locks(tablet), { Admin: null, Sophie: 'code', Max: null })
    await call('DELETE', '/account/parental-code', sophieLaptop, { password: SOPHIE.password })
    assert.deepEqual(await locks(tablet), { Admin: null, Sophie: null, Max: null })
  })

  it('never reads as another account signed in on the device from a profile id typed in the cookie', async () => {
    // Sophie's laptop, where Antho signed in after her; his profile is private again.
    const on = await call('PUT', '/account/private', anthoPhone, { on: true, password: ANTHO.password })
    anthoPhone = after_(anthoPhone, on)
    const laptop = await signIn(ANTHO, await signIn(SOPHIE))
    const forged = [...laptop.split('; ').filter(part => !part.startsWith('hodi_profile=')), 'hodi_profile=1'].join(
      '; '
    )
    assert.equal((await locks(forged)).Admin, 'password')
    // The device reads as Sophie: her account answers, never Antho's.
    const asking = await call('GET', '/account', forged)
    assert.equal(asking.status, 200)
    assert.equal(((await asking.json()) as { email: string }).email, SOPHIE.email)
    // Signing out is Sophie's too: Antho stays signed in on the laptop.
    const left = after_(forged, await call('POST', '/logout', forged))
    assert.equal((await call('PUT', '/profiles/current', left, { id: 1, password: ANTHO.password })).status, 200)
  })

  it('keeps one account at a time on a device when it is in no household', async () => {
    const lone = { email: 'lone@example.com', password: 'une autre phrase assez longue' }
    const other = { email: 'other@example.com', password: 'encore une phrase assez longue' }
    for (const account of [lone, other])
      accounts.create(account.email, await hashPassword(account.password, FAST), clock)
    const device = await signIn(other, await signIn(lone))
    const asking = await call('GET', '/account', device)
    assert.equal(((await asking.json()) as { email: string }).email, other.email)
    assert.equal(
      device
        .split('; ')
        .find(part => part.startsWith('hodi_session='))
        ?.includes('~'),
      false
    )
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

describe('the household’s Code parental from before each adult had theirs', () => {
  it('becomes the code of every adult in the household, never of a young one', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db, versionBefore('ADD COLUMN parental_code_hash'))
    db.exec(`
      UPDATE accounts SET parental_pin_hash = 'old-code' WHERE id = 1;
      INSERT INTO users (id, email, password_hash, password_changed_at, created_at) VALUES
        (10, 'parent@example.com', 'h', 0, 0), (11, 'other@example.com', 'h', 0, 0), (12, NULL, '', 0, 0);
      INSERT INTO profiles (account_id, name, color, kind, user_id, position, created_at) VALUES
        (1, 'Parent', 'tech', 'adult', 10, 1, 0), (1, 'Autre', 'sport', 'adult', 11, 2, 0),
        (1, 'Enfant', 'world', 'child', 12, 3, 0);
      INSERT INTO account_parents (child_id, parent_id, created_at) VALUES (12, 10, 0);
    `)
    migrate(db)
    const codes = db.prepare('SELECT id, parental_code_hash AS code FROM users ORDER BY id').all()
    assert.deepEqual(
      codes.map(row => ({ ...row })),
      [
        { id: 10, code: 'old-code' },
        { id: 11, code: 'old-code' },
        { id: 12, code: null }
      ]
    )
  })
})
