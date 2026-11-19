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
import { UserStore } from '../db/user-store.ts'
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
    users: (id: number) => new UserStore(db, id),
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

  it('keeps what the person read and earned on the account, whatever household it is in', async () => {
    const env = await start()
    try {
      const owner = `a${env.samAccount.id}`
      // Read on Sam's profile: the rows are the account's.
      env.users(env.samId).addReadings(
        [
          { id: 'a1', sourceId: 'rtbf', sourceName: 'RTBF', topicId: null, minutes: 4, at: 1, kind: 'article' },
          {
            id: 'a2',
            sourceId: 'rtbf',
            sourceName: 'RTBF',
            topicId: null,
            minutes: 2,
            at: 2,
            kind: 'article',
            done: false,
            progress: 0.3,
            position: 0.3,
            estimate: 5
          },
          { id: 'v1', sourceId: 'yt', sourceName: 'YT', topicId: null, minutes: 6, at: 3, kind: 'video' }
        ],
        1
      )
      env.db
        .prepare(
          `INSERT INTO game_events (owner, kind, ref, points, at, day, hour) VALUES (?, 'article_read', 'a1', 10, 1, '2026-11-19', 9)`
        )
        .run(owner)
      const owners = () =>
        env.db
          .prepare('SELECT DISTINCT owner FROM readings')
          .all()
          .map(row => row.owner)
      assert.deepEqual(owners(), [owner])
      const view = async () => ((await (await env.call('/account', env.sam)).json()) as { stats: unknown }).stats

      // In the household, Réglages › Statistiques shows them.
      assert.equal(await view(), null)
      assert.equal((await env.call('/account/leave', env.sam, 'POST', { password: SAM_PASSWORD })).status, 204)
      // Nothing moved: the account's rows stay as they were. The unfinished article does not count as read.
      assert.deepEqual(owners(), [owner])
      assert.deepEqual(await view(), { articles: 1, videos: 1, minutes: 10, points: 10 })
      const copy = (await (await env.call('/account/copy', env.sam)).json()) as {
        stats: { readings: unknown[]; gameEvents: unknown[] }
      }
      assert.deepEqual([copy.stats.readings.length, copy.stats.gameEvents.length], [3, 1])

      // In a household again: its profile reads the account's.
      const { id: again } = (await (
        await env.call('/profiles', env.admin, 'POST', { name: 'Sam', color: 'monde', kind: 'adult' })
      ).json()) as { id: number }
      env.accounts.linkProfile(env.samAccount.id, again)
      assert.deepEqual(
        env
          .users(again)
          .getState()
          .readings.map(reading => reading.id),
        ['a1', 'a2', 'v1']
      )
    } finally {
      env.close()
    }
  })

  it('hands a profile’s own over to the account it gets; a young one’s go with it, an account’s with the account', async () => {
    const env = await start()
    try {
      const reading = {
        id: 'x',
        sourceId: 'rtbf',
        sourceName: 'RTBF',
        topicId: null,
        minutes: 1,
        at: 1,
        kind: 'article' as const
      }
      const count = (owner: string) =>
        env.db.prepare('SELECT COUNT(*) AS n FROM readings WHERE owner = ?').get(owner)?.n
      // An adult profile with no account yet reads: its own rows, handed over once its person joins.
      const { id: noe } = (await (
        await env.call('/profiles', env.admin, 'POST', { name: 'Noé', color: 'sport', kind: 'adult' })
      ).json()) as { id: number }
      env.users(noe).addReadings([reading], 1)
      assert.equal(count(`p${noe}`), 1)
      const account = env.accounts.create('noe@example.com', 'unused-hash', 0)!
      env.accounts.linkProfile(account.id, noe)
      assert.deepEqual([count(`p${noe}`), count(`a${account.id}`)], [0, 1])

      // A child's go with its profile.
      env.users(env.leaId).addReadings([reading], 1)
      env.profiles.delete(env.leaId)
      assert.equal(count(`p${env.leaId}`), 0)

      // Removed by the admin, Sam keeps them; deleting the account deletes them.
      env.users(env.samId).addReadings([reading], 1)
      env.profiles.delete(env.samId)
      assert.equal(count(`a${env.samAccount.id}`), 1)
      env.db.prepare('DELETE FROM users WHERE id = ?').run(env.samAccount.id)
      assert.equal(count(`a${env.samAccount.id}`), 0)
    } finally {
      env.close()
    }
  })
})
