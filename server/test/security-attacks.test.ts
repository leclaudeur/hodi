import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { createApp } from '../app.ts'
import { LoginThrottle } from '../auth/login-throttle.ts'
import type { Config } from '../config.ts'
import { AccountDataStore } from '../db/account-data.ts'
import { openDatabase } from '../db/database.ts'
import { HouseholdStore } from '../db/household-store.ts'
import { ProfileDeviceStore } from '../db/profile-device-store.ts'
import { ProfileStore } from '../db/profile-store.ts'
import { SignInCodeStore } from '../db/sign-in-code-store.ts'
import { UserAccountStore } from '../db/user-account-store.ts'
import { UserDeviceStore } from '../db/user-device-store.ts'
import { UserStore } from '../db/user-store.ts'
import { isPublicAddressUrl } from '../news/address-guard.ts'
import { parseCatalog } from '../news/catalog.ts'
import { NewsService } from '../news/news-service.ts'
import { fakeFetch } from './helpers/news.ts'

// The attacks of the security audit, each on a real install over HTTP: what got through before is shut, and what was
// already refused stays refused.

const PASSWORD = 'une phrase de passe assez longue'
const SECRET = Buffer.alloc(32, 7)
const EMAIL = 'antho@example.com'
const SETUP = {
  name: 'Chez nous',
  profile: { name: 'Antho', color: 'tech' },
  timeZone: 'Europe/Brussels',
  country: 'BE',
  ai: null
}

const startInstall = async (now: () => number) => {
  const db = openDatabase(':memory:')
  const profiles = new ProfileStore(db)
  const accounts = new UserAccountStore(db)
  const profileDevices = new ProfileDeviceStore(db)
  const webDir = mkdtempSync(path.join(tmpdir(), 'hodi-web-'))
  writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>Hodi</title>')
  const config: Config = {
    host: '127.0.0.1',
    port: 0,
    sessionSecret: SECRET,
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
    profiles,
    household: new HouseholdStore(db),
    accounts,
    devices: new UserDeviceStore(db),
    profileDevices,
    users: profileId => new UserStore(db, profileId),
    accountData: new AccountDataStore(db),
    codes: new SignInCodeStore(db, SECRET),
    setupCode: 'K7PM2QXR',
    now,
    aiProviders: [],
    // Generous: the attacks below fail on purpose, and must not lock the tests out.
    throttle: new LoginThrottle(50, 60_000)
  }).listen(0)
  await new Promise(resolve => server.once('listening', resolve))
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  const call = (url: string, { method = 'GET', cookie = '', body, headers = {} }: CallOptions = {}) =>
    fetch(`${baseUrl}${url.startsWith('/') && !url.startsWith('/api') ? `/api${url}` : url}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(cookie ? { cookie } : {}),
        ...headers
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
    })

  const account = await call('/setup/account', { method: 'POST', body: { email: EMAIL, password: PASSWORD } })
  let admin = cookiesFrom(account)
  admin = `${admin}; ${cookiesFrom(await call('/setup', { method: 'POST', cookie: admin, body: SETUP }))}`

  return { db, profiles, accounts, profileDevices, call, admin, close: () => server.close() }
}

interface CallOptions {
  method?: string
  cookie?: string
  body?: unknown
  headers?: Record<string, string>
}

const cookiesFrom = (response: Response) =>
  response.headers
    .getSetCookie()
    .map(cookie => cookie.split(';')[0])
    .join('; ')

// The same cookies, with one of them replaced or added.
const withCookie = (cookies: string, next: string) => {
  const name = next.split('=')[0]
  return [...cookies.split('; ').filter(cookie => !cookie.startsWith(`${name}=`)), next].join('; ')
}

describe('a row that goes never lets its cookie open the next one given its id', () => {
  let clock = Date.UTC(2026, 10, 9, 9)
  let install: Awaited<ReturnType<typeof startInstall>>

  before(async () => {
    install = await startInstall(() => clock)
  })
  after(() => install.close())

  const signIn = async (email = EMAIL) => {
    const response = await install.call('/login', { method: 'POST', body: { email, password: PASSWORD } })
    assert.equal(response.status, 204)
    return cookiesFrom(response)
  }
  const sessionStatus = async (cookie: string) => (await install.call('/session', { cookie })).status
  const invite = async (email: string, name: string) => {
    const { code } = (await (
      await install.call('/codes', { method: 'POST', cookie: install.admin, body: {} })
    ).json()) as {
      code: string
    }
    const joined = await install.call('/codes/join', {
      method: 'POST',
      body: { email, password: PASSWORD, ageConfirmed: true, code, profile: { name, color: 'world' } }
    })
    assert.equal(joined.status, 200)
    return cookiesFrom(joined)
  }

  it('keeps a device signed out from Appareils out, after the account signs in again elsewhere', async () => {
    const kept = await signIn()
    clock += 60_000
    const lost = await signIn()
    const view = (await (await install.call('/account', { cookie: kept })).json()) as {
      devices: { id: number; current: boolean }[]
    }
    const lostId = Math.max(...view.devices.map(device => device.id))
    assert.equal((await install.call(`/account/devices/${lostId}`, { method: 'DELETE', cookie: kept })).status, 200)
    assert.equal(await sessionStatus(lost), 401)

    // A minute later, a new sign-in: SQLite gives its device the id of the one signed out.
    clock += 60_000
    const fresh = await signIn()
    const after = (await (await install.call('/account', { cookie: fresh })).json()) as {
      devices: { id: number; current: boolean }[]
    }
    assert.equal(after.devices.find(device => device.current)?.id, lostId)
    assert.equal(await sessionStatus(fresh), 200)
    assert.equal(await sessionStatus(lost), 401)
  })

  it("never opens the next account with a deleted account's cookie", async () => {
    const sam = await invite('sam@example.com', 'Sam')
    const samId = install.accounts.byEmail('sam@example.com')!.id
    const deleted = await install.call('/account', { method: 'DELETE', cookie: sam, body: { password: PASSWORD } })
    assert.equal(deleted.status, 204)
    assert.equal(await sessionStatus(sam), 401)

    clock += 60_000
    await invite('zoe@example.com', 'Zoé')
    assert.equal(install.accounts.byEmail('zoe@example.com')!.id, samId)
    assert.equal(await sessionStatus(sam), 401)
  })

  it("never opens the next young device with a removed one's cookie", async () => {
    const lea = install.profiles.create('Léa', 'music', clock, { kind: 'teen' })!.id
    const link = async () => {
      const { code } = (await (
        await install.call('/codes', { method: 'POST', cookie: install.admin, body: { profileId: lea } })
      ).json()) as { code: string }
      const linked = await install.call('/codes/link', { method: 'POST', body: { code } })
      assert.equal(linked.status, 200)
      return cookiesFrom(linked)
    }
    const removed = await link()
    const [device] = install.profileDevices.list(lea, clock)
    const gone = await install.call(`/profiles/${lea}/devices/${device!.id}`, {
      method: 'DELETE',
      cookie: install.admin
    })
    assert.equal(gone.status, 204)

    clock += 60_000
    const linked = await link()
    assert.equal(install.profileDevices.list(lea, clock)[0]!.id, device!.id)
    assert.equal(await sessionStatus(linked), 200)
    assert.equal(await sessionStatus(removed), 401)
  })

  it('opens a device with a cookie from before creation times only when it was linked before them', async () => {
    const lea = install.profiles.list().find(profile => profile.name === 'Léa')!.id
    const [device] = install.profileDevices.list(lea, clock)
    const payload = `y1.${device!.id}`
    const key = createHmac('sha256', SECRET).update('profile-device').digest()
    const old = `hodi_session=${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`
    assert.equal(await sessionStatus(old), 401)

    install.db.prepare('UPDATE profile_devices SET legacy = 1 WHERE id = ?').run(device!.id)
    const legacy = await install.call('/session', { cookie: old })
    assert.equal(legacy.status, 200)
    // Replaced at once by one naming the row's creation time.
    assert.match(cookiesFrom(legacy), /hodi_session=y2\.\d+\.\d+\./)
  })

  it("never opens the next adult profile with a deleted profile's signed cookie", async () => {
    const joined = await invite('max@example.com', 'Max')
    const maxCookie = joined.split('; ').find(cookie => cookie.startsWith('hodi_profile='))!
    const max = install.profiles.list().find(profile => profile.name === 'Max')!.id
    const deleted = await install.call(`/profiles/${max}`, {
      method: 'DELETE',
      cookie: install.admin,
      body: { password: PASSWORD }
    })
    assert.equal(deleted.status, 204)

    clock += 60_000
    await invite('ines@example.com', 'Inès')
    assert.equal(install.profiles.list().find(profile => profile.name === 'Inès')!.id, max)
    const session = (await (
      await install.call('/session', { cookie: withCookie(install.admin, maxCookie) })
    ).json()) as {
      profileChosen: boolean
    }
    assert.equal(session.profileChosen, false)
  })
})

// A household's admin gives codes for a new password: never to the server's admin, nor to someone who also reads in
// another household.
describe('reset codes stay within what a household admin may do', () => {
  const clock = Date.UTC(2026, 10, 9, 9)
  let install: Awaited<ReturnType<typeof startInstall>>
  let anthoProfile: number
  let marie: string

  before(async () => {
    install = await startInstall(() => clock)
    anthoProfile = install.profiles.list()[0]!.id
    const join = async (email: string, name: string) => {
      const { code } = (await (
        await install.call('/codes', { method: 'POST', cookie: install.admin, body: {} })
      ).json()) as { code: string }
      const joined = await install.call('/codes/join', {
        method: 'POST',
        body: { email, password: PASSWORD, ageConfirmed: true, code, profile: { name, color: 'world' } }
      })
      assert.equal(joined.status, 200)
      return { cookie: cookiesFrom(joined), profileId: ((await joined.json()) as { profileId: number }).profileId }
    }
    const joined = await join('marie@example.com', 'Marie')
    await join('sophie@example.com', 'Sophie')
    await join('paul@example.com', 'Paul')
    // Antho, the server's admin, hands the household over to Marie.
    install.db.prepare("UPDATE profiles SET role = 'member' WHERE id = ?").run(anthoProfile)
    install.db.prepare("UPDATE profiles SET role = 'admin' WHERE id = ?").run(joined.profileId)
    marie = joined.cookie
  })
  after(() => install.close())

  const profileOf = (name: string) => install.profiles.list().find(profile => profile.name === name)!.id
  // Marie's own password, as « Nouveau mot de passe » asks for it.
  const makeCode = (profileId: number) =>
    install.call('/codes', { method: 'POST', cookie: marie, body: { profileId, password: PASSWORD } })

  it("refuses a code for the server admin's password", async () => {
    const refused = await makeCode(anthoProfile)
    assert.equal(refused.status, 403)
    assert.deepEqual(await refused.json(), { error: 'server_admin' })
  })

  it('refuses a code made before its account became the server admin', async () => {
    const sophie = profileOf('Sophie')
    const made = await makeCode(sophie)
    assert.equal(made.status, 201)
    const { code } = (await made.json()) as { code: string }
    install.db.prepare('UPDATE users SET server_admin = 1 WHERE email = ?').run('sophie@example.com')
    const reset = await install.call('/codes/reset', {
      method: 'POST',
      body: { code, password: 'une autre phrase de passe assez longue' }
    })
    assert.equal(reset.status, 403)
    assert.equal(
      (
        await install.call('/login', {
          method: 'POST',
          body: { email: 'sophie@example.com', password: PASSWORD }
        })
      ).status,
      204
    )
  })

  it('refuses a code for an account that also reads in another household', async () => {
    const now = Date.now()
    install.db
      .prepare(
        `INSERT INTO accounts (id, name, created_at, set_up_at, time_zone, language)
         VALUES (2, 'Famille Martin', ?, ?, 'Europe/Paris', 'fr')`
      )
      .run(now, now)
    const elsewhere = new ProfileStore(install.db, 2).create('Paul', 'world', now)!
    install.accounts.linkProfile(install.accounts.byEmail('paul@example.com')!.id, elsewhere.id)
    const refused = await makeCode(profileOf('Paul'))
    assert.equal(refused.status, 403)
    assert.deepEqual(await refused.json(), { error: 'other_households' })
  })
})

describe('attacks from outside', () => {
  let install: Awaited<ReturnType<typeof startInstall>>

  before(async () => {
    install = await startInstall(Date.now)
  })
  after(() => install.close())

  describe('requests from another site', () => {
    it('refuses a change sent by another site, even a sibling subdomain', async () => {
      for (const site of ['cross-site', 'same-site']) {
        const deleted = await install.call('/account', {
          method: 'DELETE',
          cookie: install.admin,
          headers: { 'Sec-Fetch-Site': site, 'Content-Type': 'text/plain' },
          body: 'x'
        })
        assert.equal(deleted.status, 403)
        assert.deepEqual(await deleted.json(), { error: 'cross_site' })
        const changed = await install.call('/household', {
          method: 'PATCH',
          cookie: install.admin,
          headers: { 'Sec-Fetch-Site': site },
          body: { name: 'Piraté' }
        })
        assert.equal(changed.status, 403)
      }
      assert.ok(install.accounts.byEmail(EMAIL))
    })

    it("lets Hodi's own pages, the address bar and clients without the header through", async () => {
      for (const headers of [{ 'Sec-Fetch-Site': 'same-origin' }, { 'Sec-Fetch-Site': 'none' }, {}]) {
        const login = await install.call('/login', {
          method: 'POST',
          headers,
          body: { email: EMAIL, password: PASSWORD }
        })
        assert.equal(login.status, 204)
      }
      // Reading is never a change.
      const read = await install.call('/session', {
        cookie: install.admin,
        headers: { 'Sec-Fetch-Site': 'cross-site' }
      })
      assert.equal(read.status, 200)
    })
  })

  describe('injections', () => {
    it('signs nobody in with SQL in the e-mail or the password', async () => {
      for (const email of [`${EMAIL}' OR '1'='1`, "' OR 1=1--@example.com", `${EMAIL}"--`, `${EMAIL}'; --`]) {
        const response = await install.call('/login', {
          method: 'POST',
          body: { email, password: "x' OR '1'='1" }
        })
        assert.ok([400, 401].includes(response.status), `${email}: ${response.status}`)
        assert.equal(response.headers.getSetCookie().length, 0)
      }
      const response = await install.call('/login', { method: 'POST', body: { email: EMAIL, password: "' OR '1'='1" } })
      assert.equal(response.status, 401)
    })

    it('searches for SQL and full-text syntax as plain words', async () => {
      const queries = [
        "' OR 1=1--",
        '"',
        'a" OR "b',
        'NEAR(',
        '*',
        'title:x',
        ') OR (',
        '^a',
        'a AND OR NOT',
        '\u0000',
        "'; DROP TABLE users;--"
      ]
      for (const query of queries) {
        const response = await install.call(`/search?q=${encodeURIComponent(query)}`, { cookie: install.admin })
        assert.equal(response.status, 200, JSON.stringify(query))
      }
      assert.ok(install.accounts.byEmail(EMAIL))
    })

    it('refuses a body that would reach Object.prototype', async () => {
      const response = await install.call('/me/preferences', {
        method: 'PUT',
        cookie: install.admin,
        body: '{"__proto__":{"admin":true},"constructor":{"prototype":{"admin":true}}}'
      })
      assert.equal(response.status, 400)
      assert.equal(({} as Record<string, unknown>).admin, undefined)
    })

    it('refuses values of the wrong type, and bodies too large or too deep', async () => {
      const login = await install.call('/login', { method: 'POST', body: { email: [EMAIL], password: PASSWORD } })
      assert.equal(login.status, 400)
      const current = await install.call('/profiles/current', {
        method: 'PUT',
        cookie: install.admin,
        body: { id: '1 OR 1=1' }
      })
      assert.equal(current.status, 400)
      const large = await install.call('/household', {
        method: 'PATCH',
        cookie: install.admin,
        body: { name: 'x'.repeat(3000) }
      })
      assert.equal(large.status, 413)
      const deep = await install.call('/me/preferences', {
        method: 'PUT',
        cookie: install.admin,
        body: '['.repeat(5000) + ']'.repeat(5000)
      })
      assert.ok([400, 413].includes(deep.status), String(deep.status))
      // The server still answers.
      assert.equal((await install.call('/session', { cookie: install.admin })).status, 200)
    })

    it('opens no file outside its own through an address', async () => {
      for (const address of [
        '/%2e%2e/%2e%2e/etc/passwd',
        '/..%2f..%2fetc%2fpasswd',
        '/assets/..%2f..%2f..%2fpackage.json',
        "/api/articles/1'%20OR%20'1'='1"
      ]) {
        const response = await install.call(address, { cookie: install.admin })
        const text = await response.text()
        assert.ok(!text.includes('root:') && !text.includes('"devDependencies"'), address)
        assert.ok(response.status === 200 ? text.includes('<title>Hodi</title>') : response.status < 500, address)
      }
    })

    it('never fetches an address of the server itself or of its network', async () => {
      for (const url of [
        'http://127.0.0.1:3000/health',
        'http://localhost/',
        'http://[::1]/',
        'http://0x7f000001/',
        'http://2130706433/',
        'http://127.1/',
        'http://0/',
        'http://[::ffff:127.0.0.1]/',
        'http://169.254.169.254/latest/meta-data/',
        'http://10.0.0.1/',
        'http://192.168.1.1/',
        'http://[fd00::1]/',
        'file:///etc/passwd',
        'gopher://127.0.0.1:25/'
      ]) {
        assert.equal(await isPublicAddressUrl(new URL(url)), false, url)
      }
    })
  })
})
