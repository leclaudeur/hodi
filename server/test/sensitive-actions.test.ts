import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { Secret, TOTP } from 'otpauth'
import { createApp } from '../app.ts'
import { LoginThrottle } from '../auth/login-throttle.ts'
import { hashPassword } from '../auth/password.ts'
import type { Config } from '../config.ts'
import { AccountDataStore } from '../db/account-data.ts'
import { openDatabase } from '../db/database.ts'
import { InstallStore } from '../db/install-store.ts'
import { ProfileStore } from '../db/profile-store.ts'
import { ServerPeopleStore } from '../db/server-people-store.ts'
import { ServerSettingsStore } from '../db/server-settings-store.ts'
import { ServerStatsStore } from '../db/server-stats-store.ts'
import { SignInCodeStore } from '../db/sign-in-code-store.ts'
import { TwoFactorStore } from '../db/two-factor-store.ts'
import { UserAccountStore } from '../db/user-account-store.ts'
import { UserDeviceStore } from '../db/user-device-store.ts'
import { parseCatalog } from '../news/catalog.ts'
import { NewsService } from '../news/news-service.ts'
import { fakeFetch } from './helpers/news.ts'

// The moments that cannot be undone ask for the person's own password, whatever the device's session (proof.ts):
// handing over the admin role, and deleting an account or a household from /server.

const ADMIN_PASSWORD = 'une phrase de passe assez longue'
const SAM_PASSWORD = 'la phrase de Sam'
const FAST = { N: 2 ** 10, r: 8, p: 1 }

const cookiesFrom = (response: Response) =>
  response.headers
    .getSetCookie()
    .map(cookie => cookie.split(';')[0])
    .join('; ')

// A household « Chez nous »: Antho, its admin and the server's, and Sam, an adult with an account, and Léa, a child.
// withTwoFactor: « Validation en deux étapes » exists on this install, on a clock the test moves.
const start = async ({ withTwoFactor = false }: { withTwoFactor?: boolean } = {}) => {
  const db = openDatabase(':memory:')
  const clock = { now: Date.UTC(2026, 10, 9, 10, 0, 0) }
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
  const install = new InstallStore(db)
  const accounts = new UserAccountStore(db)
  const profiles = new ProfileStore(db)
  const settings = new ServerSettingsStore(db)
  const twoFactor = new TwoFactorStore(db, config.sessionSecret)
  const server = createApp(config, {
    news: new NewsService(parseCatalog('topics:\n  - id: monde\n    label: Monde\n    sources: []\n'), {
      fetchText: fakeFetch({}).fetchText,
      log: () => {}
    }),
    profiles,
    install,
    accounts,
    devices: new UserDeviceStore(db),
    accountData: new AccountDataStore(db),
    serverStats: new ServerStatsStore(db, () => 'UTC'),
    serverPeople: new ServerPeopleStore(db),
    serverSettings: settings,
    codes: new SignInCodeStore(db, Buffer.alloc(32, 6)),
    throttle: new LoginThrottle(5, 60_000),
    ...(withTwoFactor ? { twoFactor, now: () => clock.now } : {})
  }).listen(0)
  await new Promise(resolve => server.once('listening', resolve))
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  const call = (url: string, cookie: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
    fetch(`${baseUrl}/api${url}`, {
      method,
      headers: { cookie, ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body)
    })

  const signedIn = await call('/setup/account', '', 'POST', { email: 'antho@example.com', password: ADMIN_PASSWORD })
  const session = cookiesFrom(signedIn)
  const setup = await call('/setup', session, 'POST', {
    name: 'Chez nous',
    profile: { name: 'Antho', color: 'tech' },
    timeZone: 'Europe/Brussels',
    country: 'BE',
    ai: null
  })
  const admin = `${session}; ${cookiesFrom(setup)}`
  const { id: samId } = (await (
    await call('/profiles', admin, 'POST', { name: 'Sam', color: 'monde', kind: 'adult' })
  ).json()) as { id: number }
  const samAccount = accounts.create('sam@example.com', await hashPassword(SAM_PASSWORD, FAST), 0)!
  accounts.linkProfile(samAccount.id, samId)
  const { id: leaId } = (await (
    await call('/profiles', admin, 'POST', { name: 'Léa', color: 'sport', kind: 'child' })
  ).json()) as { id: number }
  // Sam on a phone of their own.
  const sam = cookiesFrom(await call('/login', '', 'POST', { email: 'sam@example.com', password: SAM_PASSWORD }))

  return {
    call,
    admin,
    sam,
    samId,
    samAccount,
    leaId,
    accounts,
    profiles,
    settings,
    twoFactor,
    clock,
    db,
    close: () => server.close()
  }
}

describe('no household admin role', () => {
  it('hands nothing over: the route is gone and the roles stay as they were', async () => {
    const { call, admin, sam, samId, leaId, profiles, close } = await start()
    try {
      const before = profiles.list().map(profile => [profile.name, profile.role])
      assert.equal((await call(`/profiles/${samId}/admin`, admin, 'PUT', { password: ADMIN_PASSWORD })).status, 404)
      assert.deepEqual(
        profiles.list().map(profile => [profile.name, profile.role]),
        before
      )
      // Sam manages no one else's profile: Léa, the admin's child, is not even on his device.
      assert.equal((await call(`/profiles/${leaId}`, sam, 'DELETE', { password: SAM_PASSWORD })).status, 404)
      assert.equal((await call(`/profiles/${leaId}`, admin, 'DELETE', { password: ADMIN_PASSWORD })).status, 204)
    } finally {
      close()
    }
  })
})

describe('the admin’s password before what cannot be undone for another adult', () => {
  it('never deletes the profile of an adult with an account, which goes only with the account; a child’s, yes', async () => {
    const { call, admin, samId, leaId, accounts, close } = await start()
    try {
      // Not on the admin's device, and refused even where Sam signs in too.
      assert.equal((await call(`/profiles/${samId}`, admin, 'DELETE', { password: ADMIN_PASSWORD })).status, 404)
      const both = await call('/login', admin, 'POST', { email: 'sam@example.com', password: SAM_PASSWORD })
      const shared = [
        ...admin.split('; ').filter(part => !part.startsWith('hodi_session=')),
        ...both.headers.getSetCookie().map(cookie => cookie.split(';')[0]!)
      ].join('; ')
      const refused = await call(`/profiles/${samId}`, shared, 'DELETE', { password: ADMIN_PASSWORD })
      assert.deepEqual([refused.status, await refused.json()], [409, { error: 'account_profile' }])
      assert.notEqual(accounts.ofProfile(samId), null)
      assert.equal((await call(`/profiles/${leaId}`, admin, 'DELETE', { password: ADMIN_PASSWORD })).status, 204)
    } finally {
      close()
    }
  })

  it('counts wrong passwords as at the Connexion page, from the same device', async () => {
    const { call, admin, samAccount, close } = await start()
    const fromAfar = { 'X-Forwarded-For': '203.0.113.7' }
    const url = `/server/accounts/${samAccount.id}`
    try {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const wrong = await call(url, admin, 'DELETE', { password: `faux ${attempt}` }, fromAfar)
        assert.equal(wrong.status, 403)
      }
      const blocked = await call(url, admin, 'DELETE', { password: ADMIN_PASSWORD }, fromAfar)
      assert.equal(blocked.status, 429)
    } finally {
      close()
    }
  })
})

describe('Serveur › Comptes › « Supprimer »', () => {
  it('deletes an account with the server admin’s password, never the server admin’s own', async () => {
    const { call, admin, sam, samId, samAccount, accounts, profiles, close } = await start()
    try {
      const url = `/server/accounts/${samAccount.id}`
      assert.equal((await call(url, sam, 'DELETE', { password: SAM_PASSWORD })).status, 403)
      assert.equal((await call(url, admin, 'DELETE', {})).status, 403)
      assert.equal((await call(url, admin, 'DELETE', { password: SAM_PASSWORD })).status, 403)
      assert.equal((await call('/server/accounts/999', admin, 'DELETE', { password: ADMIN_PASSWORD })).status, 404)
      // The server admin's own account goes from Compte et données, with what it takes there.
      const own = await call(`/server/accounts/${accounts.byEmail('antho@example.com')!.id}`, admin, 'DELETE', {
        password: ADMIN_PASSWORD
      })
      assert.deepEqual([own.status, await own.json()], [403, { error: 'server_admin' }])

      assert.equal((await call(url, admin, 'DELETE', { password: ADMIN_PASSWORD })).status, 204)
      assert.equal(accounts.get(samAccount.id), null)
      assert.equal(
        profiles.list().some(profile => profile.id === samId),
        false
      )
      // Signed out everywhere, and no sign-in any more.
      assert.equal((await call('/session', sam)).status, 401)
      const login = await call('/login', '', 'POST', { email: 'sam@example.com', password: SAM_PASSWORD })
      assert.equal(login.status, 401)
    } finally {
      close()
    }
  })

  // The profiles' role grants nothing any more: nobody inherits anything when an account goes.
  it('hands no role to anyone when an account with the old admin role goes', async () => {
    const { call, admin, samId, samAccount, profiles, accounts, db, close } = await start()
    try {
      // Sam, its admin as an older install could have it.
      db.prepare("UPDATE profiles SET role = CASE id WHEN ? THEN 'admin' ELSE 'member' END").run(samId)
      const url = `/server/accounts/${samAccount.id}`
      assert.equal((await call(url, admin, 'DELETE', { password: ADMIN_PASSWORD })).status, 204)
      assert.deepEqual(
        profiles.list().map(profile => [profile.name, profile.role]),
        [
          ['Antho', 'member'],
          ['Léa', 'member']
        ]
      )
      assert.deepEqual(
        accounts.serverAdmins().map(account => account.email),
        ['antho@example.com']
      )
    } finally {
      close()
    }
  })
})

describe('Serveur › Comptes › « Bloquer »', () => {
  it('deletes the account and keeps its e-mail from any account again, never the server admin’s own', async () => {
    const { call, admin, sam, samAccount, accounts, db, close } = await start()
    try {
      const url = `/server/accounts/${samAccount.id}/block`
      assert.equal((await call(url, sam, 'POST', { password: SAM_PASSWORD })).status, 403)
      assert.equal((await call(url, admin, 'POST', {})).status, 403)
      const own = await call(`/server/accounts/${accounts.byEmail('antho@example.com')!.id}/block`, admin, 'POST', {
        password: ADMIN_PASSWORD
      })
      assert.deepEqual([own.status, await own.json()], [403, { error: 'server_admin' }])

      assert.equal((await call(url, admin, 'POST', { password: ADMIN_PASSWORD })).status, 204)
      assert.equal(accounts.get(samAccount.id), null)
      assert.equal((await call('/session', sam)).status, 401)
      // Told at Connexion, whatever the password; the address itself is not kept.
      const login = await call('/login', '', 'POST', { email: ' Sam@example.com', password: 'nimporte quoi' })
      assert.deepEqual([login.status, await login.json()], [403, { error: 'blocked' }])
      assert.equal(JSON.stringify(db.prepare('SELECT * FROM blocked_emails').all()).includes('sam@'), false)
      // No new account with it, nor an e-mail changed to it.
      assert.equal(accounts.create('sam@example.com', 'unused-hash', 1), null)
      const changed = await call('/account/email', admin, 'PUT', { email: 'sam@example.com', password: ADMIN_PASSWORD })
      assert.deepEqual([changed.status, await changed.json()], [409, { error: 'email_taken' }])

      // « Débloquer une adresse », with the password: it may make an account again.
      const unblock = '/server/accounts/unblock'
      assert.equal((await call(unblock, admin, 'POST', { email: 'sam@example.com' })).status, 403)
      assert.equal(
        (await call(unblock, admin, 'POST', { email: 'nope@example.com', password: ADMIN_PASSWORD })).status,
        404
      )
      assert.equal(
        (await call(unblock, admin, 'POST', { email: 'Sam@example.com', password: ADMIN_PASSWORD })).status,
        204
      )
      assert.notEqual(accounts.create('sam@example.com', 'unused-hash', 1), null)
    } finally {
      close()
    }
  })
})

describe('a blocked e-mail at Connexion', () => {
  it('counts as a failed sign-in, so nobody tries addresses at full speed', async () => {
    const { call, admin, samAccount, close } = await start()
    try {
      await call(`/server/accounts/${samAccount.id}/block`, admin, 'POST', { password: ADMIN_PASSWORD })
      const tries = []
      for (let count = 0; count < 6; count++)
        tries.push((await call('/login', '', 'POST', { email: 'sam@example.com', password: 'x' })).status)
      // The throttle in these tests allows 5 failures.
      assert.deepEqual(tries, [403, 403, 403, 403, 403, 429])
    } finally {
      close()
    }
  })
})

describe('« Nommer admin du serveur »', () => {
  it('makes an adult a server admin, chosen by an admin with their password only', async () => {
    const { call, admin, sam, samAccount, accounts, close } = await start()
    try {
      const url = `/server/accounts/${samAccount.id}/server-admin`
      assert.equal((await call(url, sam, 'POST', { password: ADMIN_PASSWORD })).status, 403)
      assert.equal((await call(url, admin, 'POST')).status, 403)
      assert.equal(
        (await call('/server/accounts/999/server-admin', admin, 'POST', { password: ADMIN_PASSWORD })).status,
        404
      )
      assert.equal(accounts.get(samAccount.id)?.serverAdmin, false)
      assert.equal((await call(url, admin, 'POST', { password: ADMIN_PASSWORD })).status, 204)
      assert.equal(accounts.get(samAccount.id)?.serverAdmin, true)
      // Already one.
      assert.equal((await call(url, admin, 'POST', { password: ADMIN_PASSWORD })).status, 409)
    } finally {
      close()
    }
  })
})

describe('Serveur › Foyers, gone', () => {
  it('deletes no household, even with the server admin’s password', async () => {
    const { call, admin, sam, samAccount, accounts, close } = await start()
    try {
      // Neither the list nor a household of its own is served any more.
      assert.equal((await call('/server/households', admin)).status, 404)
      assert.equal((await call('/server/households/1', admin, 'DELETE', { password: ADMIN_PASSWORD })).status, 404)
      assert.notEqual(accounts.get(samAccount.id), null)
      assert.equal((await call('/session', sam)).status, 200)
    } finally {
      close()
    }
  })
})

// The code an authenticator app shows for a secret at a time.
const appCode = (secret: string, at: number) =>
  new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 }).generate({ timestamp: at })

describe('« Validation en deux étapes »', () => {
  // Antho turns it on from Compte et données: the password first, then the app's first code.
  const turnOn = async (env: Awaited<ReturnType<typeof start>>, cookie = env.admin) => {
    const started = await env.call('/account/two-factor', cookie, 'POST', { password: ADMIN_PASSWORD })
    assert.equal(started.status, 200)
    const { secret, uri } = (await started.json()) as { secret: string; uri: string }
    assert.match(uri, /^otpauth:\/\/totp\/Hodi:antho%40example\.com\?issuer=Hodi&secret=[A-Z2-7]+/)
    assert.doesNotMatch(uri, /algorithm|digits|period/)
    const confirmed = await env.call('/account/two-factor', cookie, 'PUT', { code: appCode(secret, env.clock.now) })
    assert.equal(confirmed.status, 200)
    const { recoveryCodes } = (await confirmed.json()) as { recoveryCodes: string[] }
    return { secret, recoveryCodes }
  }

  it('turns on with the app’s first code, and shows ten recovery codes once', async () => {
    const env = await start({ withTwoFactor: true })
    try {
      // Long after the sign-in, the password is asked: a taken session cannot tie the account to another phone.
      env.clock.now += 10 * 60_000
      assert.equal((await env.call('/account/two-factor', env.admin, 'POST', {})).status, 403)
      const started = await env.call('/account/two-factor', env.admin, 'POST', { password: ADMIN_PASSWORD })
      const { secret } = (await started.json()) as { secret: string }
      assert.equal((await env.call('/account/two-factor', env.admin, 'PUT', { code: '000000' })).status, 403)
      const confirmed = await env.call('/account/two-factor', env.admin, 'PUT', {
        code: appCode(secret, env.clock.now)
      })
      const { recoveryCodes } = (await confirmed.json()) as { recoveryCodes: string[] }
      assert.equal(recoveryCodes.length, 10)
      assert.ok(recoveryCodes.every(code => /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/.test(code)))
      const view = (await (await env.call('/account', env.admin)).json()) as {
        twoFactor: { since: number; required: boolean; recoveryLeft: number }
      }
      assert.deepEqual(view.twoFactor, { since: env.clock.now, required: true, recoveryLeft: 10 })
      const session = (await (await env.call('/session', env.admin)).json()) as { twoFactor: boolean }
      assert.equal(session.twoFactor, true)
      // Nothing of it in the database in clear.
      const row = env.db.prepare('SELECT two_factor_secret AS sealed FROM users WHERE id = 1').get() as {
        sealed: string
      }
      assert.doesNotMatch(row.sealed, new RegExp(secret))
      const hashes = env.db.prepare('SELECT code_hash AS hash FROM recovery_codes').all() as { hash: string }[]
      assert.ok(hashes.every(({ hash }) => !recoveryCodes.some(code => hash.includes(code.replace('-', '')))))
    } finally {
      env.close()
    }
  })

  it('asks for the app’s code after the right password at sign-in, or a recovery code once', async () => {
    const env = await start({ withTwoFactor: true })
    try {
      const { secret, recoveryCodes } = await turnOn(env)
      const login = (body: Record<string, unknown>) =>
        env.call('/login', '', 'POST', { email: 'antho@example.com', password: ADMIN_PASSWORD, ...body })
      const asked = await login({})
      assert.deepEqual([asked.status, await asked.json()], [403, { error: 'two_factor_required' }])
      assert.equal(asked.headers.getSetCookie().length, 0)
      const wrong = await login({ code: '123456' })
      assert.deepEqual([wrong.status, await wrong.json()], [403, { error: 'invalid_code' }])
      // A wrong password never says whether the account has it on.
      const badPassword = await env.call('/login', '', 'POST', { email: 'antho@example.com', password: 'faux' })
      assert.equal(badPassword.status, 401)

      env.clock.now += 30_000
      const code = appCode(secret, env.clock.now)
      assert.equal((await login({ code })).status, 204)
      // The same code twice: refused, as one seen over a shoulder.
      assert.equal((await login({ code })).status, 403)

      // A recovery code, typed in small letters: once.
      const recovery = recoveryCodes[0]!.toLowerCase()
      assert.equal((await login({ code: recovery })).status, 204)
      assert.equal((await login({ code: recovery })).status, 403)
      const view = (await (await env.call('/account', env.admin)).json()) as { twoFactor: { recoveryLeft: number } }
      assert.equal(view.twoFactor.recoveryLeft, 9)
    } finally {
      env.close()
    }
  })

  it('takes the app’s code with the password at the moments that ask for it', async () => {
    const env = await start({ withTwoFactor: true })
    try {
      const { secret } = await turnOn(env)
      env.clock.now += 30_000
      const url = `/server/accounts/${env.samAccount.id}`
      assert.equal((await env.call(url, env.admin, 'DELETE', { password: ADMIN_PASSWORD })).status, 403)
      const wrong = await env.call(url, env.admin, 'DELETE', { password: ADMIN_PASSWORD, code: '000000' })
      assert.deepEqual(await wrong.json(), { error: 'invalid_code' })
      const done = await env.call(url, env.admin, 'DELETE', {
        password: ADMIN_PASSWORD,
        code: appCode(secret, env.clock.now)
      })
      assert.equal(done.status, 204)
    } finally {
      env.close()
    }
  })

  it('keeps /server’s moments closed until the server admin turns it on, and never lets them turn it off', async () => {
    const env = await start({ withTwoFactor: true })
    try {
      const url = `/server/accounts/${env.samAccount.id}`
      const closed = await env.call(url, env.admin, 'DELETE', { password: ADMIN_PASSWORD })
      assert.deepEqual([closed.status, await closed.json()], [403, { error: 'two_factor_setup' }])

      const { secret } = await turnOn(env)
      env.clock.now += 30_000
      const proof = { password: ADMIN_PASSWORD, code: appCode(secret, env.clock.now) }
      const off = await env.call('/account/two-factor', env.admin, 'DELETE', proof)
      assert.deepEqual([off.status, await off.json()], [403, { error: 'required' }])
      assert.equal((await env.call(url, env.admin, 'DELETE', proof)).status, 204)
    } finally {
      env.close()
    }
  })

  it('lets another adult turn it off, and gives new recovery codes, with the password and a code', async () => {
    const env = await start({ withTwoFactor: true })
    try {
      // Sam, on a phone signed in a moment ago: no password needed to start.
      const started = await env.call('/account/two-factor', env.sam, 'POST', {})
      const { secret } = (await started.json()) as { secret: string }
      await env.call('/account/two-factor', env.sam, 'PUT', { code: appCode(secret, env.clock.now) })
      const samProof = () => ({ password: SAM_PASSWORD, code: appCode(secret, (env.clock.now += 30_000)) })

      const renewed = await env.call('/account/two-factor/recovery-codes', env.sam, 'POST', samProof())
      assert.equal(((await renewed.json()) as { recoveryCodes: string[] }).recoveryCodes.length, 10)
      assert.equal((await env.call('/account/two-factor', env.sam, 'DELETE', samProof())).status, 204)
      assert.equal(env.twoFactor.isOn(env.samAccount.id), false)
      const login = await env.call('/login', '', 'POST', { email: 'sam@example.com', password: SAM_PASSWORD })
      assert.equal(login.status, 204)
    } finally {
      env.close()
    }
  })

  it('signs in on the Connexion page after a new password by code, with the app’s code', async () => {
    const env = await start({ withTwoFactor: true })
    try {
      const started = await env.call('/account/two-factor', env.sam, 'POST', {})
      const { secret } = (await started.json()) as { secret: string }
      await env.call('/account/two-factor', env.sam, 'PUT', { code: appCode(secret, env.clock.now) })

      // A code for a new password, as Serveur › Comptes makes it.
      const { code } = new SignInCodeStore(env.db, Buffer.alloc(32, 6)).create(
        { profileId: env.samId, createdBy: 1, reset: true },
        env.clock.now
      )
      const NEW_PASSWORD = 'une nouvelle phrase pour Sam'
      const reset = await env.call('/codes/reset', '', 'POST', { code, password: NEW_PASSWORD })
      assert.deepEqual(await reset.json(), { profileId: env.samId, signIn: false })
      assert.equal(reset.headers.getSetCookie().length, 0)
      const login = await env.call('/login', '', 'POST', { email: 'sam@example.com', password: NEW_PASSWORD })
      assert.deepEqual(await login.json(), { error: 'two_factor_required' })
    } finally {
      env.close()
    }
  })
})
