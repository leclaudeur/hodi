import assert from 'node:assert/strict'
import sharp from 'sharp'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, before, describe, it } from 'node:test'
import { unzipSync } from 'fflate'
import { readdirSync } from 'node:fs'
import { createApp } from '../app.ts'
import { hashPassword } from '../auth/password.ts'
import type { Config } from '../config.ts'
import { openDatabase } from '../db/database.ts'
import { HouseholdStore } from '../db/household-store.ts'
import { MailSettingsStore, mailDraftOf } from '../db/mail-settings-store.ts'
import { copyTimeOf, isDatabaseFile, readRestoreTime } from '../db/maintenance.ts'
import { ProfileStore } from '../db/profile-store.ts'
import { ServerPeopleStore } from '../db/server-people-store.ts'
import { ServerSettingsStore } from '../db/server-settings-store.ts'
import { ServerStatsStore } from '../db/server-stats-store.ts'
import { SignInCodeStore } from '../db/sign-in-code-store.ts'
import { UserAccountStore } from '../db/user-account-store.ts'
import { UserDeviceStore } from '../db/user-device-store.ts'
import { deviceKindOf } from '../http/presence.ts'
import { MailError, type MailMessage, smtpSend } from '../mail/mailer.ts'
import { parseCatalog } from '../news/catalog.ts'
import { NewsService } from '../news/news-service.ts'
import { fakeFetch } from './helpers/news.ts'

const DAY = 24 * 60 * 60 * 1000
// Friday 6 November 2026, 15:00 in Brussels.
const NOW = Date.UTC(2026, 10, 6, 14, 0)

describe('server stats', () => {
  it('counts every profile together, day by day, read articles only', () => {
    const db = openDatabase(':memory:')
    const stats = new ServerStatsStore(db, () => 'Europe/Brussels')
    const insert = db.prepare(
      `INSERT INTO readings (profile_id, article_id, source_id, source_name, topic_id, minutes, read_at, kind, done)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    insert.run('a', 'rtl', 'RTL info', 'belgium', 4, NOW - 60_000, 'article', 1)
    insert.run('b', 'rtl', 'RTL info', 'belgium', 3, NOW - DAY, 'article', null)
    // Opened and left: not read.
    insert.run('c', 'rfi', 'RFI', 'world', 1, NOW - 60_000, 'article', 0)
    insert.run('d', 'yt', 'Une chaîne', 'world', 12, NOW - 60_000, 'video', null)
    // Out of the week.
    insert.run('e', 'rfi', 'RFI', 'world', 5, NOW - 9 * DAY, 'article', 1)

    // The profile the database starts with, made the day before, in its household set up then: a household left for
    // later is not counted.
    db.prepare('UPDATE profiles SET created_at = ? WHERE id = 1').run(NOW - DAY)
    db.prepare('UPDATE accounts SET set_up_at = ? WHERE id = 1').run(NOW - DAY)

    stats.recordVisit(1, NOW)
    stats.recordVisit(1, NOW + 1000)

    const week = stats.overview({ days: 7 }, NOW)
    assert.equal(week.days.length, 7)
    assert.equal(week.days.at(-1)?.day, '2026-11-06')
    assert.deepEqual(week.days.at(-1), {
      day: '2026-11-06',
      visits: 1,
      articles: 1,
      videos: 1,
      minutes: 16,
      shares: 0,
      profiles: 0,
      accounts: 0,
      activeAccounts: 0
    })
    assert.equal(week.days.at(-2)?.articles, 1)
    assert.equal(week.days.at(-2)?.profiles, 1)
    assert.deepEqual(week.topics, [
      { id: 'belgium', count: 2 },
      { id: 'world', count: 1 }
    ])
    assert.deepEqual(week.sources[0], { id: 'rtl', name: 'RTL info', count: 2 })
    assert.equal(week.households, 1)
    assert.equal(stats.overview({ days: 30 }, NOW).days.length, 30)
  })

  it('keeps visits a month, as a number of profiles', () => {
    const db = openDatabase(':memory:')
    const stats = new ServerStatsStore(db, () => 'UTC')
    stats.recordVisit(1, NOW - 40 * DAY)
    stats.recordVisit(1, NOW)
    const kept = db.prepare('SELECT day FROM profile_visits').all() as { day: string }[]
    assert.deepEqual(
      kept.map(row => row.day),
      ['2026-11-06']
    )
  })

  it('tells phones, tablets and computers apart from the browser name alone', () => {
    assert.equal(deviceKindOf('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148'), 'phone')
    assert.equal(deviceKindOf('Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile Safari/537.36'), 'phone')
    assert.equal(deviceKindOf('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)'), 'tablet')
    assert.equal(deviceKindOf('Mozilla/5.0 (Linux; Android 15; SM-X710) Safari/537.36'), 'tablet')
    assert.equal(deviceKindOf('Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0'), 'computer')
  })
})

describe('server settings', () => {
  it('keeps the content durations within their bounds, with their defaults', () => {
    const db = openDatabase(':memory:')
    const settings = new ServerSettingsStore(db)
    assert.deepEqual(settings.content(), { articleDays: 3, videoDays: 60, textDays: 7 })
    settings.setContent({ articleDays: 5 })
    assert.deepEqual(new ServerSettingsStore(db).content(), { articleDays: 5, videoDays: 60, textDays: 7 })
    // A value written outside its bounds by hand is read as the default.
    db.prepare("INSERT INTO server_settings (key, value) VALUES ('textDays', 900)").run()
    assert.equal(new ServerSettingsStore(db).content().textDays, 7)
  })
})

describe('server overview route', () => {
  let baseUrl: string
  let close: () => void
  let adminCookie = ''
  let memberCookie = ''
  let backupDir = ''
  let pendingRestore = ''
  let pluginDataDir = ''
  let restarts = 0
  const db = openDatabase(':memory:')
  // What the fake mail server received; a host named refuse.example refuses the password.
  const sent: MailMessage[] = []

  const call = (url: string, cookie: string, method = 'GET', body?: unknown) =>
    fetch(`${baseUrl}/api${url}`, {
      method,
      headers: {
        cookie,
        'user-agent': 'Mozilla/5.0 (iPhone) Mobile',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  const cookiesFrom = (response: Response) =>
    response.headers
      .getSetCookie()
      .map(cookie => cookie.split(';')[0])
      .join('; ')

  before(async () => {
    const webDir = mkdtempSync(path.join(tmpdir(), 'hodi-web-'))
    backupDir = mkdtempSync(path.join(tmpdir(), 'hodi-backups-'))
    pendingRestore = path.join(mkdtempSync(path.join(tmpdir(), 'hodi-data-')), 'restore-pending.db')
    // No plugin has data until the test that adds one.
    pluginDataDir = mkdtempSync(path.join(tmpdir(), 'hodi-plugin-data-'))
    writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>Hodi</title>')
    const config: Config = {
      host: '127.0.0.1',
      port: 0,
      sessionSecret: Buffer.alloc(32, 3),
      webDir,
      sourcesFile: 'unused.yml',
      databaseFile: ':memory:',
      backupDir: 'unused-backups',
      timeZone: 'UTC',
      vapid: { publicKey: 'unused', privateKey: 'unused', subject: 'mailto:test@example.com' }
    }
    const catalog = parseCatalog('topics:\n  - id: monde\n    label: Monde\n    sources: []\n')
    const household = new HouseholdStore(db)
    const accounts = new UserAccountStore(db)
    const server = createApp(config, {
      news: new NewsService(catalog, { fetchText: fakeFetch({}).fetchText, log: () => {} }),
      profiles: new ProfileStore(db),
      household,
      accounts,
      devices: new UserDeviceStore(db),
      serverStats: new ServerStatsStore(db, () => 'UTC'),
      serverPeople: new ServerPeopleStore(db),
      serverSettings: new ServerSettingsStore(db),
      serverBackups: {
        db,
        dir: backupDir,
        plugins: { dataDir: pluginDataDir, snapshots: () => null },
        restore: { pending: pendingRestore, restart: () => (restarts += 1) }
      },
      serverMail: {
        store: new MailSettingsStore(db),
        send: async (settings, message) => {
          if (settings.host === 'refuse.example') throw new MailError('auth')
          sent.push(message)
        }
      },
      codes: new SignInCodeStore(db, Buffer.alloc(32, 4))
    }).listen(0)
    await new Promise(resolve => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    close = () => server.close()

    const account = await fetch(`${baseUrl}/api/setup/account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'antho@example.com', password: 'une phrase de passe assez longue' })
    })
    const session = cookiesFrom(account)
    const setup = await fetch(`${baseUrl}/api/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: session },
      body: JSON.stringify({
        name: 'Chez nous',
        profile: { name: 'Antho', color: 'tech' },
        timeZone: 'Europe/Brussels',
        country: 'BE',
        ai: null
      })
    })
    adminCookie = `${session}; ${cookiesFrom(setup)}`
    const created = await call('/profiles', adminCookie, 'POST', { name: 'Sam', color: 'monde', kind: 'adult' })
    const { id } = (await created.json()) as { id: number }
    const sam = accounts.create(
      'sam@example.com',
      await hashPassword('la phrase de Sam', { N: 2 ** 10, r: 8, p: 1 }),
      0
    )!
    accounts.linkProfile(sam.id, id)
    const chosen = await call('/profiles/current', adminCookie, 'PUT', { id, password: 'la phrase de Sam' })
    memberCookie = `${adminCookie.split('; ').find(cookie => !cookie.startsWith('hodi_profile'))}; ${cookiesFrom(chosen)}`
  })

  after(() => close())

  it('gives the server admin the totals and who is online, and nobody else', async () => {
    // Sam opens Hodi on a phone: Sam is online, and a visit of the day.
    assert.equal((await call('/server/overview', memberCookie)).status, 403)

    const response = await call('/server/overview?days=7', adminCookie)
    assert.equal(response.status, 200)
    const overview = (await response.json()) as {
      households: number
      profiles: { adults: number; young: number }
      days: { visits: number; profiles: number }[]
      online: { name: string; household: string; device: string }[]
    }
    assert.equal(overview.households, 1)
    assert.deepEqual(overview.profiles, { adults: 2, young: 0 })
    assert.equal(overview.days.length, 7)
    assert.equal(overview.days.at(-1)?.visits, 2)
    assert.equal(overview.days.at(-1)?.profiles, 2)
    assert.deepEqual(overview.online.map(entry => [entry.name, entry.household, entry.device]).sort(), [
      ['Antho', 'Chez nous', 'phone'],
      ['Sam', 'Chez nous', 'phone']
    ])
    assert.equal((await call('/server/overview?days=12', adminCookie)).status, 400)
    assert.equal((await call('/server/overview?days=365', adminCookie)).status, 200)
    const chosen = await call('/server/overview?from=2026-11-01&to=2026-11-03', adminCookie)
    assert.deepEqual(
      ((await chosen.json()) as { days: { day: string }[] }).days.map(day => day.day),
      ['2026-11-01', '2026-11-02', '2026-11-03']
    )
    assert.equal((await call('/server/overview?from=2026-11-03&to=2026-11-01', adminCookie)).status, 400)
    assert.equal((await call('/server/overview?from=2026-02-30&to=2026-03-01', adminCookie)).status, 400)
  })

  it('lists the households and the accounts, and makes their codes', async () => {
    assert.equal((await call('/server/accounts', memberCookie)).status, 403)

    const { households, maxProfiles } = (await (await call('/server/households', adminCookie)).json()) as {
      households: { id: number; name: string; admin: string; adults: number; young: number; accounts: number }[]
      maxProfiles: number
    }
    assert.equal(maxProfiles, 5)
    assert.deepEqual(
      households.map(({ name, admin, adults, young, accounts }) => ({ name, admin, adults, young, accounts })),
      [{ name: 'Chez nous', admin: 'Antho', adults: 2, young: 0, accounts: 2 }]
    )

    const { accounts } = (await (await call('/server/accounts', adminCookie)).json()) as {
      accounts: {
        id: number
        email: string
        serverAdmin: boolean
        profile: { name: string; role: string } | null
        household: { name: string } | null
        devices: number
      }[]
    }
    const byEmail = Object.fromEntries(accounts.map(account => [account.email, account]))
    assert.equal(byEmail['antho@example.com']?.serverAdmin, true)
    assert.equal(byEmail['antho@example.com']?.profile?.role, 'admin')
    assert.equal(byEmail['sam@example.com']?.profile?.name, 'Sam')
    assert.equal(byEmail['sam@example.com']?.household?.name, 'Chez nous')

    // An invitation into the household, then a new password for Sam: both are « J'ai un code » codes.
    const invite = await call(`/server/households/${households[0]!.id}/code`, adminCookie, 'POST')
    assert.equal(invite.status, 201)
    const { code: inviteCode } = (await invite.json()) as { code: string }
    const checked = await call('/codes/check', '', 'POST', { code: inviteCode })
    assert.equal(((await checked.json()) as { kind: string }).kind, 'invite')

    const samCode = `/server/accounts/${byEmail['sam@example.com']!.id}/code`
    // It opens Sam's account: the server admin's own password first.
    assert.equal((await call(samCode, adminCookie, 'POST')).status, 403)
    const reset = await call(samCode, adminCookie, 'POST', { password: 'une phrase de passe assez longue' })
    assert.equal(reset.status, 201)
    const { code: resetCode } = (await reset.json()) as { code: string }
    const resetUse = await call('/codes/check', '', 'POST', { code: resetCode })
    assert.equal(((await resetUse.json()) as { kind: string }).kind, 'reset')

    // One's own password changes with the current one, in Réglages › Compte et données.
    assert.equal(
      (await call(`/server/accounts/${byEmail['antho@example.com']!.id}/code`, adminCookie, 'POST')).status,
      400
    )
    assert.equal((await call('/server/accounts/999/code', adminCookie, 'POST')).status, 404)
  })

  it('keeps the household’s photo, set by its admin, shown to its people and to the server’s admin', async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#c06040' } })
      .png()
      .toBuffer()
    const put = (cookie: string, body: Uint8Array, type = 'image/png') =>
      fetch(`${baseUrl}/api/household/photo`, {
        method: 'PUT',
        headers: { cookie, 'Content-Type': type },
        body: new Uint8Array(body)
      })

    assert.equal(((await (await call('/household', adminCookie)).json()) as { photo: unknown }).photo, null)
    // Réglages › Foyer is its admin's: Sam reads in the household, but does not run it.
    assert.equal((await put(memberCookie, png)).status, 403)
    // What the bytes are, not what the request says.
    assert.equal((await put(adminCookie, Buffer.from('not a picture'))).status, 400)
    assert.equal((await put(adminCookie, png, 'image/jpeg')).status, 400)
    // A picture far larger than the app ever makes: a few kilobytes that would unpack into gigabytes.
    const huge = await sharp({ create: { width: 1100, height: 8, channels: 3, background: '#000' } })
      .png()
      .toBuffer()
    assert.equal((await put(adminCookie, huge)).status, 400)

    const saved = await put(adminCookie, png)
    assert.equal(saved.status, 200)
    const { photo } = (await saved.json()) as { photo: string }
    assert.match(photo, /^\/api\/households\/\d+\/photo\?v=\d+$/)
    const id = Number(/households\/(\d+)/.exec(photo)![1])

    // Its people see it, as Village's « Quel foyer ? » would.
    const seen = await fetch(`${baseUrl}${photo}`, { headers: { cookie: memberCookie } })
    assert.equal(seen.status, 200)
    assert.equal(seen.headers.get('content-type'), 'image/png')
    assert.deepEqual(Buffer.from(await seen.arrayBuffer()), png)
    // Nobody else: no session, or another household's address.
    assert.equal((await fetch(`${baseUrl}${photo}`)).status, 401)
    assert.equal((await call(`/households/${id + 1}/photo`, memberCookie)).status, 404)

    // The server's admin, for Serveur › Foyers.
    const listed = (await (await call('/server/households', adminCookie)).json()) as {
      households: { id: number; photoVersion: number | null }[]
    }
    assert.notEqual(listed.households.find(household => household.id === id)?.photoVersion, null)
    assert.equal((await call(`/server/households/${id}/photo`, adminCookie)).status, 200)
    assert.equal((await call(`/server/households/${id}/photo`, memberCookie)).status, 403)

    const removed = await call('/household/photo', adminCookie, 'DELETE')
    assert.equal(((await removed.json()) as { photo: unknown }).photo, null)
    assert.equal((await fetch(`${baseUrl}${photo}`, { headers: { cookie: memberCookie } })).status, 404)
  })

  it('shows an account’s profile photo to the server’s admin, in Serveur › Comptes', async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#4060c0' } })
      .png()
      .toBuffer()
    const accounts = async () =>
      (
        (await (await call('/server/accounts', adminCookie)).json()) as {
          accounts: { email: string; profile: { id: number; photoVersion: number | null } | null }[]
        }
      ).accounts
    const sam = (await accounts()).find(account => account.email === 'sam@example.com')!.profile!
    assert.equal(sam.photoVersion, null)
    assert.equal((await call(`/server/accounts/photos/${sam.id}`, adminCookie)).status, 404)

    // Sam puts a photo on Sam's own profile.
    const saved = await fetch(`${baseUrl}/api/profiles/${sam.id}/photo`, {
      method: 'PUT',
      headers: { cookie: memberCookie, 'Content-Type': 'image/png' },
      body: new Uint8Array(png)
    })
    assert.equal(saved.status, 200)

    const version = (await accounts()).find(account => account.email === 'sam@example.com')!.profile!.photoVersion
    assert.notEqual(version, null)
    const seen = await call(`/server/accounts/photos/${sam.id}?v=${version}`, adminCookie)
    assert.equal(seen.status, 200)
    assert.equal(seen.headers.get('content-type'), 'image/png')
    assert.deepEqual(Buffer.from(await seen.arrayBuffer()), png)
    // The server's admin only: Sam reads in the household, but does not run the server.
    assert.equal((await call(`/server/accounts/photos/${sam.id}`, memberCookie)).status, 403)
    assert.equal((await call('/server/accounts/photos/nope', adminCookie)).status, 404)

    assert.equal((await call(`/profiles/${sam.id}/photo`, memberCookie, 'DELETE')).status, 200)
    assert.equal((await call(`/server/accounts/photos/${sam.id}`, adminCookie)).status, 404)
  })

  it('changes how long the server keeps what it fetches, for the server admin only', async () => {
    const read = (await (await call('/server/content', adminCookie)).json()) as {
      values: Record<string, number>
      bounds: Record<string, { min: number; max: number; byDefault: number }>
    }
    assert.deepEqual(read.values, { articleDays: 3, videoDays: 60, textDays: 7 })
    assert.deepEqual(read.bounds.articleDays, { min: 1, max: 14, byDefault: 3 })

    assert.equal((await call('/server/content', memberCookie, 'PATCH', { articleDays: 5 })).status, 403)
    assert.equal((await call('/server/content', adminCookie, 'PATCH', { articleDays: 15 })).status, 400)
    assert.equal((await call('/server/content', adminCookie, 'PATCH', { somethingElse: 5 })).status, 400)
    assert.equal((await call('/server/content', adminCookie, 'PATCH', {})).status, 400)
    const changed = await call('/server/content', adminCookie, 'PATCH', { articleDays: 5, videoDays: 90 })
    assert.deepEqual(((await changed.json()) as { values: unknown }).values, {
      articleDays: 5,
      videoDays: 90,
      textDays: 7
    })
    // Every profile's pages say the new durations.
    const session = (await (await call('/session', memberCookie)).json()) as { content: unknown }
    assert.deepEqual(session.content, { articleDays: 5, videoDays: 90, backupCopies: 7 })
    // And anyone, signed in or not: what a plugin's legal pages say.
    const open = await fetch(`${baseUrl}/api/server-settings`)
    assert.equal(open.status, 200)
    assert.deepEqual(await open.json(), {
      articleDays: 5,
      videoDays: 90,
      textDays: 7,
      backupCopies: 7,
      maxSources: null
    })
  })

  it('sets how many sources a household may follow, or no limit, for the server admin only', async () => {
    const read = (await (await call('/server/content', adminCookie)).json()) as { maxSources: unknown }
    assert.deepEqual(read.maxSources, { value: null, min: 10, max: 1000 })

    assert.equal((await call('/server/content', memberCookie, 'PATCH', { maxSources: 50 })).status, 403)
    for (const wrong of [5, 1001, 12.5, '50', 0])
      assert.equal((await call('/server/content', adminCookie, 'PATCH', { maxSources: wrong })).status, 400)
    const changed = await call('/server/content', adminCookie, 'PATCH', { maxSources: 50 })
    assert.deepEqual(((await changed.json()) as { maxSources: unknown }).maxSources, { value: 50, min: 10, max: 1000 })
    // What a plugin's legal pages say.
    const open = (await (await fetch(`${baseUrl}/api/server-settings`)).json()) as { maxSources: unknown }
    assert.equal(open.maxSources, 50)

    const back = await call('/server/content', adminCookie, 'PATCH', { maxSources: null })
    assert.equal(((await back.json()) as { maxSources: { value: unknown } }).maxSources.value, null)
  })

  it('makes a copy at once, keeps as many as asked, and gives one only with the password', async () => {
    assert.equal((await call('/server/backups', memberCookie, 'POST')).status, 403)
    const made = await call('/server/backups', adminCookie, 'POST')
    assert.equal(made.status, 201)
    const state = (await made.json()) as { copies: { name: string; bytes: number }[]; kept: number }
    assert.equal(state.kept, 7)
    assert.equal(state.copies.length, 1)
    const [copy] = state.copies
    assert.match(copy!.name, /^hodi-\d{4}-\d{2}-\d{2}-\d{6}\.db$/)
    assert.ok(copy!.bytes > 0)

    const download = (name: string, password: string) =>
      call(`/server/backups/${name}/download`, adminCookie, 'POST', { password })
    assert.equal((await download(copy!.name, 'pas le bon')).status, 403)
    assert.equal((await download('hodi-1999-01-01.db', 'une phrase de passe assez longue')).status, 404)
    assert.equal((await download('..%2Fhodi.db', 'une phrase de passe assez longue')).status, 404)
    const file = await download(copy!.name, 'une phrase de passe assez longue')
    assert.equal(file.status, 200)
    assert.match(file.headers.get('content-disposition') ?? '', /attachment/)
    // A SQLite file, whole.
    const bytes = Buffer.from(await file.arrayBuffer())
    assert.equal(bytes.subarray(0, 15).toString(), 'SQLite format 3')
    assert.equal(bytes.length, copy!.bytes)

    assert.equal((await call('/server/backups', adminCookie, 'PATCH', { kept: 31 })).status, 400)
    await new Promise(resolve => setTimeout(resolve, 1100))
    await call('/server/backups', adminCookie, 'POST')
    const fewer = await call('/server/backups', adminCookie, 'PATCH', { kept: 1 })
    const [left] = ((await fewer.json()) as { copies: { name: string }[] }).copies
    // The copy left and its plugins' folder: the older copy went with its own.
    assert.deepEqual(readdirSync(backupDir).sort(), [left!.name, left!.name.replace(/\.db$/, '.plugins')])
  })

  it('restores a copy with the password: the state of now is kept, and Hodi restarts on the copy', async () => {
    const [copy] = (
      (await (await call('/server/backups', adminCookie)).json()) as { copies: { name: string; bytes: number }[] }
    ).copies
    const restore = (name: string, password: string, cookie = adminCookie) =>
      call(`/server/backups/${name}/restore`, cookie, 'POST', { password })
    assert.equal((await restore(copy!.name, 'une phrase de passe assez longue', memberCookie)).status, 403)
    assert.equal((await restore(copy!.name, 'pas le bon')).status, 403)
    assert.equal((await restore('hodi-1999-01-01.db', 'une phrase de passe assez longue')).status, 404)
    assert.equal(existsSync(pendingRestore), false)
    assert.equal(restarts, 0)

    await new Promise(resolve => setTimeout(resolve, 1100))
    const done = await restore(copy!.name, 'une phrase de passe assez longue')
    assert.equal(done.status, 202)
    await new Promise(resolve => setTimeout(resolve, 50))
    assert.equal(restarts, 1)
    // The copy waits for the next start, whole. With one copy kept, the state of now took its place in the list.
    assert.equal(readFileSync(pendingRestore).length, copy!.bytes)
    assert.ok(isDatabaseFile(pendingRestore))
    const after = (await (await call('/server/backups', adminCookie)).json()) as { copies: { name: string }[] }
    assert.equal(after.copies.length, 1)
    assert.notEqual(after.copies[0]!.name, copy!.name)
  })
  it('puts the plugins’ data in each copy: a zip to download, set aside with the copy on restore', async () => {
    // A plugin's database, as it is on disk (no plugin runs here: it is copied as it is).
    const plugin = new DatabaseSync(
      path.join(mkdirSync(path.join(pluginDataDir, 'village'), { recursive: true })!, 'plugin.db')
    )
    plugin.exec("CREATE TABLE waitlist (email TEXT); INSERT INTO waitlist VALUES ('marie@example.com')")
    plugin.close()
    await new Promise(resolve => setTimeout(resolve, 1100))
    const made = (await (await call('/server/backups', adminCookie, 'POST')).json()) as {
      copies: { name: string; bytes: number }[]
    }
    const [copy] = made.copies
    const pluginBytes = statSync(path.join(pluginDataDir, 'village', 'plugin.db')).size
    assert.equal(copy!.bytes, statSync(path.join(backupDir, copy!.name)).size + pluginBytes)

    const file = await call(`/server/backups/${copy!.name}/download`, adminCookie, 'POST', {
      password: 'une phrase de passe assez longue'
    })
    assert.equal(file.status, 200)
    assert.equal(file.headers.get('content-type'), 'application/zip')
    assert.match(file.headers.get('content-disposition') ?? '', /filename="hodi-[\d-]+\.zip"/)
    const entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
    assert.deepEqual(Object.keys(entries).sort(), [copy!.name, 'plugins/copy.json', 'plugins/village.db'].sort())
    assert.equal(Buffer.from(entries[copy!.name]!).subarray(0, 15).toString(), 'SQLite format 3')
    assert.equal(entries['plugins/village.db']!.length, pluginBytes)
    assert.deepEqual(JSON.parse(Buffer.from(entries['plugins/copy.json']!).toString()), {
      plugins: ['village'],
      missing: []
    })

    await new Promise(resolve => setTimeout(resolve, 1100))
    const done = await call(`/server/backups/${copy!.name}/restore`, adminCookie, 'POST', {
      password: 'une phrase de passe assez longue'
    })
    assert.equal(done.status, 202)
    // The plugins' copies wait beside the core's for the next start.
    assert.deepEqual(readdirSync(`${pendingRestore.replace(/\.db$/, '')}.plugins`).sort(), ['copy.json', 'village.db'])
    // With when it was made, from its name: the deletions since are done again at the next start.
    assert.equal(readRestoreTime(pendingRestore), copyTimeOf(copy!.name))
  })

  it('keeps the mail server, never gives its password back, and sends a test to the admin', async () => {
    assert.equal((await call('/server/mail', memberCookie)).status, 403)
    assert.deepEqual(await (await call('/server/mail', adminCookie)).json(), { mail: null })
    assert.equal((await call('/server/mail/test', adminCookie, 'POST')).status, 409)

    const settings = {
      host: 'SMTP.example.com ',
      port: 587,
      security: 'starttls',
      user: 'hodi@example.com',
      password: 'sk-test-mail',
      sender: 'Hodi@Example.com'
    }
    assert.equal((await call('/server/mail', memberCookie, 'PUT', settings)).status, 403)
    assert.equal((await call('/server/mail', adminCookie, 'PUT', { ...settings, port: 70_000 })).status, 400)
    assert.equal((await call('/server/mail', adminCookie, 'PUT', { ...settings, security: 'ssl' })).status, 400)
    assert.equal((await call('/server/mail', adminCookie, 'PUT', { ...settings, host: 'http://x/y' })).status, 400)
    const saved = await call('/server/mail', adminCookie, 'PUT', settings)
    const expected = {
      host: 'smtp.example.com',
      port: 587,
      security: 'starttls',
      user: 'hodi@example.com',
      hasPassword: true,
      sender: 'hodi@example.com',
      appUrl: null
    }
    assert.deepEqual(await saved.json(), { mail: expected })
    assert.doesNotMatch(JSON.stringify(await (await call('/server/mail', adminCookie)).json()), /sk-test-mail/)

    // Saved again without a password: the one before stays.
    await call('/server/mail', adminCookie, 'PUT', { ...settings, password: undefined, port: 465, security: 'tls' })
    const store = new MailSettingsStore(db)
    assert.equal(store.get()?.password, 'sk-test-mail')
    assert.equal(store.get()?.port, 465)

    const test = await call('/server/mail/test', adminCookie, 'POST')
    assert.deepEqual(await test.json(), { to: 'antho@example.com' })
    assert.equal(sent.length, 1)
    assert.equal(sent[0]!.to, 'antho@example.com')
    assert.match(sent[0]!.subject, /Hodi/)

    await call('/server/mail', adminCookie, 'PUT', { ...settings, host: 'refuse.example' })
    const refused = await call('/server/mail/test', adminCookie, 'POST')
    assert.equal(refused.status, 502)
    assert.deepEqual(await refused.json(), { error: 'mail_auth' })

    // Without a user name, no password is kept either.
    await call('/server/mail', adminCookie, 'PUT', { ...settings, user: null })
    assert.equal(store.get()?.password, null)

    assert.equal((await call('/server/mail', memberCookie, 'DELETE')).status, 403)
    assert.deepEqual(await (await call('/server/mail', adminCookie, 'DELETE')).json(), { mail: null })
    assert.equal(store.get(), null)
  })
})

describe('mail', () => {
  it('reads what the admin typed, or refuses it', () => {
    const draft = { host: 'smtp.example.com', port: 25, security: 'none', user: '', sender: 'a@example.com' }
    assert.deepEqual(mailDraftOf(draft), { ...draft, user: null })
    assert.equal(mailDraftOf({ ...draft, port: '25' }), null)
    assert.equal(mailDraftOf({ ...draft, sender: 'pas une adresse' }), null)
    assert.equal(mailDraftOf({ ...draft, password: '' }), null)
    assert.equal(mailDraftOf({ ...draft, host: 'smtp example' }), null)
  })

  it('says a server that does not answer cannot be reached', async () => {
    // Nothing listens on port 9 of this machine: the connection is refused at once.
    await assert.rejects(
      smtpSend(
        {
          host: '127.0.0.1',
          port: 9,
          security: 'none',
          user: null,
          password: null,
          sender: 'hodi@example.com',
          updatedAt: 0
        },
        { to: 'a@example.com', subject: 'Essai', text: 'Essai' }
      ),
      (error: unknown) => error instanceof MailError && error.reason === 'unreachable'
    )
  })
})
