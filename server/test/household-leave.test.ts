import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { createApp } from '../app.ts'
import { LoginThrottle } from '../auth/login-throttle.ts'
import { hashPassword } from '../auth/password.ts'
import type { Config } from '../config.ts'
import { AccountDataStore } from '../db/account-data.ts'
import { openDatabase } from '../db/database.ts'
import { HouseholdStore } from '../db/household-store.ts'
import { ProfileStore } from '../db/profile-store.ts'
import { UserAccountStore } from '../db/user-account-store.ts'
import { UserDeviceStore } from '../db/user-device-store.ts'
import { parseCatalog } from '../news/catalog.ts'
import { NewsService } from '../news/news-service.ts'
import { fakeFetch } from './helpers/news.ts'

// Mon compte › Foyer › « Quitter »: the person's profile goes, the account stays in no household.

const ADMIN_PASSWORD = 'une phrase de passe assez longue'
const SAM_PASSWORD = 'la phrase de Sam'
const FAST = { N: 2 ** 10, r: 8, p: 1 }

const cookiesFrom = (response: Response) =>
  response.headers
    .getSetCookie()
    .map(cookie => cookie.split(';')[0])
    .join('; ')

// « Chez nous »: Antho, its admin and the server's, Sam, an adult with an account, and Léa, a child.
const start = async () => {
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
  const accounts = new UserAccountStore(db)
  const profiles = new ProfileStore(db)
  const server = createApp(config, {
    news: new NewsService(parseCatalog('topics:\n  - id: monde\n    label: Monde\n    sources: []\n'), {
      fetchText: fakeFetch({}).fetchText,
      log: () => {}
    }),
    profiles,
    household: new HouseholdStore(db),
    accounts,
    devices: new UserDeviceStore(db),
    accountData: new AccountDataStore(db),
    throttle: new LoginThrottle(5, 60_000)
  }).listen(0)
  await new Promise(resolve => server.once('listening', resolve))
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const call = (url: string, cookie: string, method = 'GET', body?: unknown) =>
    fetch(`${baseUrl}/api${url}`, {
      method,
      headers: { cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body)
    })

  const session = cookiesFrom(
    await call('/setup/account', '', 'POST', { email: 'antho@example.com', password: ADMIN_PASSWORD })
  )
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
  const sam = cookiesFrom(await call('/login', '', 'POST', { email: 'sam@example.com', password: SAM_PASSWORD }))
  const anthoAccount = accounts.byEmail('antho@example.com')!
  return {
    db,
    call,
    admin,
    sam,
    samId,
    samAccount,
    leaId,
    anthoAccount,
    accounts,
    profiles,
    close: () => server.close()
  }
}

describe('leaving the household from Mon compte', () => {
  it('names the heir and refuses a wrong password, the profile staying', async () => {
    const env = await start()
    try {
      const view = (await (await env.call('/account', env.admin)).json()) as {
        deletion: { householdGoes: boolean; heir: string | null }
      }
      assert.deepEqual(view.deletion, { ...view.deletion, householdGoes: false, heir: 'Sam' })
      const wrong = await env.call('/account/leave', env.sam, 'POST', { password: 'pas le bon' })
      assert.deepEqual([wrong.status, await wrong.json()], [403, { error: 'invalid_password' }])
      assert.ok(env.profiles.get(env.samId))
    } finally {
      env.close()
    }
  })

  it('takes the profile and keeps the account, which then reaches its account alone', async () => {
    const env = await start()
    try {
      const left = await env.call('/account/leave', env.sam, 'POST', { password: SAM_PASSWORD })
      assert.equal(left.status, 204)
      assert.equal(env.profiles.get(env.samId), null)
      assert.ok(env.accounts.get(env.samAccount.id))
      const session = (await (await env.call('/session', env.sam)).json()) as { noHousehold?: boolean }
      assert.equal(session.noHousehold, true)
      assert.equal((await env.call('/profiles', env.sam)).status, 423)
      assert.equal((await env.call('/account', env.sam)).status, 200)
      // Leaving twice has nothing left to take.
      const again = await env.call('/account/leave', env.sam, 'POST', { password: SAM_PASSWORD })
      assert.deepEqual([again.status, await again.json()], [409, { error: 'no_household' }])
      // The household goes on: its admin, its child.
      assert.ok(env.profiles.get(env.leaId))
      assert.equal((await env.call('/profiles', env.admin)).status, 200)
    } finally {
      env.close()
    }
  })

  it('hands the household over to the heir, and the server admin keeps /server alone', async () => {
    const env = await start()
    try {
      const anthoProfile = env.accounts.profileOf(env.anthoAccount.id)!
      const left = await env.call('/account/leave', env.admin, 'POST', { password: ADMIN_PASSWORD })
      assert.equal(left.status, 204)
      assert.equal(env.profiles.get(anthoProfile), null)
      assert.equal(env.profiles.get(env.samId)?.role, 'admin')
      assert.equal(env.accounts.get(env.anthoAccount.id)?.serverAdmin, true)
      const session = (await (await env.call('/session', env.admin)).json()) as { serverOnly?: boolean }
      assert.equal(session.serverOnly, true)
    } finally {
      env.close()
    }
  })

  it('never lets the last adult leave: no one could open the household any more', async () => {
    const env = await start()
    try {
      assert.equal((await env.call('/account/leave', env.sam, 'POST', { password: SAM_PASSWORD })).status, 204)
      const view = (await (await env.call('/account', env.admin)).json()) as { deletion: { householdGoes: boolean } }
      assert.equal(view.deletion.householdGoes, true)
      const refused = await env.call('/account/leave', env.admin, 'POST', { password: ADMIN_PASSWORD })
      assert.deepEqual([refused.status, await refused.json()], [409, { error: 'last_adult' }])
      assert.ok(env.accounts.profileOf(env.anthoAccount.id))
      assert.ok(env.profiles.get(env.leaId))
    } finally {
      env.close()
    }
  })

  it('is the adult account’s own: a child’s profile open on a device cannot', async () => {
    const env = await start()
    try {
      const opened = await env.call('/profiles/current', env.admin, 'PUT', { id: env.leaId })
      assert.equal(opened.status, 200)
      // The device's own cookie, with Léa's profile chosen in place of Antho's.
      const session = env.admin.split('; ').find(cookie => cookie.startsWith('hodi_session='))!
      const child = `${session}; ${cookiesFrom(opened)}`
      const refused = await env.call('/account/leave', child, 'POST', { password: ADMIN_PASSWORD })
      assert.equal(refused.status, 403)
      assert.ok(env.accounts.profileOf(env.anthoAccount.id))
    } finally {
      env.close()
    }
  })

  it('keeps what the person read and earned with the account, back on the profile of the household they join', async () => {
    const env = await start()
    try {
      const read = env.db.prepare(
        `INSERT INTO readings (profile_id, article_id, source_id, source_name, minutes, read_at, kind, done)
         VALUES (?, ?, 'rtbf', 'RTBF', ?, 1, ?, ?)`
      )
      read.run(env.samId, 'a1', 4, 'article', null)
      read.run(env.samId, 'a2', 2, 'article', 0)
      read.run(env.samId, 'v1', 6, 'video', 1)
      env.db
        .prepare(
          `INSERT INTO game_events (profile_id, kind, ref, points, at, day, hour) VALUES (?, 'article_read', 'a1', 10, 1, '2026-11-19', 9)`
        )
        .run(env.samId)
      const view = async () => ((await (await env.call('/account', env.sam)).json()) as { kept: unknown }).kept

      // In the household, the stats are on its profile: nothing kept apart.
      assert.equal(await view(), null)
      assert.equal((await env.call('/account/leave', env.sam, 'POST', { password: SAM_PASSWORD })).status, 204)
      // The unfinished article does not count as read.
      assert.deepEqual(await view(), { articles: 1, videos: 1, minutes: 10, points: 10 })
      const copy = (await (await env.call('/account/copy', env.sam)).json()) as {
        kept: { readings: unknown[]; gameEvents: unknown[] }
      }
      assert.deepEqual([copy.kept.readings.length, copy.kept.gameEvents.length], [3, 1])

      // Back in a household: the new profile has them, the account keeps nothing apart any more.
      const { id: again } = (await (
        await env.call('/profiles', env.admin, 'POST', { name: 'Sam', color: 'monde', kind: 'adult' })
      ).json()) as { id: number }
      env.accounts.linkProfile(env.samAccount.id, again)
      const back = env.db.prepare('SELECT article_id FROM readings WHERE profile_id = ? ORDER BY article_id').all(again)
      assert.deepEqual(
        back.map(row => row.article_id),
        ['a1', 'a2', 'v1']
      )
      const points = env.db.prepare('SELECT SUM(points) AS points FROM game_events WHERE profile_id = ?').get(again)
      assert.equal(points?.points, 10)
      assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM kept_readings').get()?.n, 0)
      assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM kept_game_events').get()?.n, 0)
    } finally {
      env.close()
    }
  })

  it('keeps them for an adult the admin removes too, and forgets them with the account', async () => {
    const env = await start()
    try {
      env.db
        .prepare(
          `INSERT INTO game_events (profile_id, kind, ref, points, at, day, hour) VALUES (?, 'article_read', 'a1', 10, 1, '2026-11-19', 9)`
        )
        .run(env.samId)
      env.profiles.delete(env.samId)
      const kept = () => env.db.prepare('SELECT COUNT(*) AS n FROM kept_game_events').get()?.n
      assert.equal(kept(), 1)
      // A child's profile has no account: nothing to keep.
      env.profiles.delete(env.leaId)
      assert.equal(kept(), 1)
      env.db.prepare('DELETE FROM users WHERE id = ?').run(env.samAccount.id)
      assert.equal(kept(), 0)
    } finally {
      env.close()
    }
  })
})
