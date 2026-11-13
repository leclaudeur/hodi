import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { createApp } from '../app.ts'
import type { Config } from '../config.ts'
import { openDatabase } from '../db/database.ts'
import { HouseholdStore } from '../db/household-store.ts'
import { ProfileStore } from '../db/profile-store.ts'
import { SourceStore } from '../db/source-store.ts'
import { UserStore } from '../db/user-store.ts'
import { YouthStore, inRange } from '../db/youth-store.ts'
import { FollowedAlerts } from '../news/followed-alerts.ts'
import { parseCatalog } from '../news/catalog.ts'
import { NewsService } from '../news/news-service.ts'
import { parseRules } from '../http/youth-routes.ts'
import { hashPassword } from '../auth/password.ts'
import type { UserAccountStore } from '../db/user-account-store.ts'
import { ADMIN_EMAIL, withAdminAccount } from './helpers/accounts.ts'
import { articlePage, fakeFetch, rssFeed } from './helpers/news.ts'
import { itemId } from '../news/text.ts'

const ZONE = 'Europe/Brussels'
// 30 October 2026, 10:00 in Brussels (UTC+1).
const MORNING = Date.UTC(2026, 9, 30, 9)
const MINUTE = 60_000

describe('youth store', () => {
  it('counts the time between heartbeats, never a long silence', () => {
    const db = openDatabase(':memory:')
    const max = new ProfileStore(db).create('Max', 'sport', MORNING, { kind: 'child' })!
    const youth = new YouthStore(db, () => ZONE)
    youth.beat(max.id, MORNING)
    youth.beat(max.id, MORNING + 30_000)
    youth.beat(max.id, MORNING + 60_000)
    // Asleep for ten minutes: nothing counts, then it starts again.
    youth.beat(max.id, MORNING + 11 * MINUTE)
    youth.beat(max.id, MORNING + 11 * MINUTE + 30_000)
    assert.equal(youth.limits(max.id, MORNING + 12 * MINUTE).usedSeconds, 90)

    // A new day in Brussels starts from zero.
    assert.equal(youth.limits(max.id, Date.UTC(2026, 9, 30, 23, 30)).usedSeconds, 0)
    const week = youth.week(max.id, MORNING)
    assert.equal(week.length, 7)
    assert.deepEqual(week.at(-1), { day: '2026-10-30', seconds: 90 })
    assert.equal(week[0]!.day, '2026-10-24')
  })

  it('opens within the hours and the minutes its parents set', () => {
    const db = openDatabase(':memory:')
    const max = new ProfileStore(db).create('Max', 'sport', MORNING, { kind: 'child' })!
    const youth = new YouthStore(db, () => ZONE)
    assert.equal(youth.limits(max.id, MORNING).access, 'open')
    assert.equal(youth.limits(max.id, MORNING).closesAt, null)

    youth.setRules(max.id, { dailyMinutes: 30, window: { start: '08:00', end: '20:00' } })
    const open = youth.limits(max.id, MORNING)
    assert.equal(open.access, 'open')
    assert.equal(open.remainingSeconds, 30 * 60)
    assert.equal(open.closesAt, MORNING + 30 * MINUTE)

    // 19:45: 15 minutes before the end of its hours, its 30 minutes count down to 20:00.
    const evening = youth.limits(max.id, Date.UTC(2026, 9, 30, 18, 45))
    assert.equal(evening.remainingSeconds, 15 * 60)
    assert.equal(evening.closesAt, Date.UTC(2026, 9, 30, 19))

    // 07:00: "À tout à l'heure", at 08:00 today.
    const early = youth.limits(max.id, Date.UTC(2026, 9, 30, 6))
    assert.equal(early.access, 'before')
    assert.equal(early.opensAt, Date.UTC(2026, 9, 30, 7))
    // 21:00: tomorrow at 08:00.
    const late = youth.limits(max.id, Date.UTC(2026, 9, 30, 20))
    assert.equal(late.access, 'after')
    assert.equal(late.opensAt, Date.UTC(2026, 9, 31, 7))

    for (let at = MORNING; at <= MORNING + 31 * MINUTE; at += 30_000) youth.beat(max.id, at)
    const spent = youth.limits(max.id, MORNING + 31 * MINUTE)
    assert.equal(spent.access, 'time_up')
    assert.equal(spent.remainingSeconds, 0)
    assert.equal(spent.opensAt, Date.UTC(2026, 9, 31, 7))
  })

  it('keeps quiet within its parents’ hours, across midnight', () => {
    const db = openDatabase(':memory:')
    const max = new ProfileStore(db).create('Max', 'sport', MORNING, { kind: 'child' })!
    const youth = new YouthStore(db, () => ZONE)
    youth.setRules(max.id, { quiet: { start: '20:30', end: '07:30' } })
    assert.equal(inRange({ start: '20:30', end: '07:30' }, Date.UTC(2026, 9, 30, 22), ZONE), true)
    assert.equal(youth.mayNotify(max.id, MORNING), true)
    assert.equal(youth.mayNotify(max.id, Date.UTC(2026, 9, 30, 5)), false)
  })

  it('takes only rules that make sense', () => {
    assert.deepEqual(parseRules({ dailyMinutes: 45 }), { dailyMinutes: 45 })
    assert.deepEqual(parseRules({ dailyMinutes: null, quiet: null }), { dailyMinutes: null, quiet: null })
    assert.deepEqual(parseRules({ dailyMinutes: 5 }), { dailyMinutes: 5 })
    assert.equal(parseRules({ dailyMinutes: 0 }), null)
    assert.equal(parseRules({ dailyMinutes: 42 }), null)
    assert.equal(parseRules({ dailyMinutes: 300 }), null)
    assert.equal(parseRules({ window: { start: '20:00', end: '08:00' } }), null)
    assert.deepEqual(parseRules({ quiet: { start: '20:00', end: '08:00' } }), {
      quiet: { start: '20:00', end: '08:00' }
    })
    assert.equal(parseRules({ window: { start: '8:00', end: '20:00' } }), null)
    assert.equal(parseRules({ explainPerDay: 21 }), null)
  })

  it('tells a young profile nothing while its parents keep it quiet', async () => {
    const sent: string[] = []
    const alerts = new FollowedAlerts({
      listItems: async () => [],
      send: async target => {
        sent.push(target.endpoint)
      },
      now: () => MORNING,
      mayNotify: profileId => profileId !== 2
    })
    const device = (profileId: number) => ({
      target: { endpoint: `https://fcm.googleapis.com/fcm/send/${profileId}`, keys: { p256dh: 'p', auth: 'a' } },
      words: [],
      mutedWords: [],
      hiddenSources: [],
      quietStart: '00:00',
      quietEnd: '00:00',
      timeZone: ZONE,
      badge: false,
      shares: true,
      reactions: true,
      profileId
    })
    alerts.register(device(1))
    alerts.register(device(2))
    await alerts.notifyShare(1, { title: 'a', body: 'b', url: '/' })
    await alerts.notifyShare(2, { title: 'a', body: 'b', url: '/' })
    assert.deepEqual(sent, ['https://fcm.googleapis.com/fcm/send/1'])
  })
})

describe('youth api', () => {
  const PASSWORD = 'a very long test password'
  let clock = MORNING
  let baseUrl = ''
  let close = () => {}
  let session = ''
  let adminProfile = ''
  let accounts: UserAccountStore
  // The signed profile cookies of the adults opened with their password, beside the admin's.
  const opened = new Map<number, string>()
  const db = openDatabase(':memory:')
  const profiles = new ProfileStore(db)
  const youth = new YouthStore(db, () => ZONE)
  const household = new HouseholdStore(db)

  const call = (method: string, route: string, profileId: number, body?: unknown) =>
    fetch(`${baseUrl}/api${route}`, {
      method,
      headers: {
        // An adult profile opens with its account's password (the admin's at sign-in); a young one with nothing.
        cookie: `${session}; ${profileId === 1 ? adminProfile : (opened.get(profileId) ?? `hodi_profile=${profileId}`)}`,
        'Content-Type': 'application/json'
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    })

  before(async () => {
    const webDir = mkdtempSync(path.join(tmpdir(), 'hodi-web-'))
    writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>Hodi</title>')
    const config: Config = {
      host: '127.0.0.1',
      port: 0,
      sessionSecret: Buffer.alloc(32, 3),
      webDir,
      sourcesFile: 'unused.yml',
      databaseFile: ':memory:',
      backupDir: 'unused-backups',
      timeZone: ZONE,
      vapid: { publicKey: 'unused', privateKey: 'unused', subject: 'mailto:test@example.com' }
    }
    household.setUp(
      {
        name: 'Foyer',
        timeZone: ZONE,
        country: null,
        ai: null
      },
      clock
    )
    const catalog = parseCatalog('topics:\n  - id: world\n    label: Monde\n    sources: []\n')
    const adminStores = await withAdminAccount(db, profiles, PASSWORD, clock)
    accounts = adminStores.accounts
    const server = createApp(config, {
      ...adminStores,
      news: new NewsService(catalog, { fetchText: fakeFetch({}).fetchText, log: () => {} }),
      profiles,
      users: profileId => new UserStore(db, profileId),
      youth,
      household,
      now: () => clock
    }).listen(0)
    await new Promise(resolve => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    close = () => server.close()
    const login = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: PASSWORD })
    })
    ;[session = '', adminProfile = ''] = login.headers.getSetCookie().map(cookie => cookie.split(';')[0]!)
  })

  after(() => close())

  it('lets the parents set a young profile’s rules, and closes its lists when its time is up', async () => {
    const sam = profiles.create('Sam', 'tech', clock)!
    const zoe = profiles.create('Zoé', 'music', clock, { kind: 'teen' })!
    // Sam is a parent with an account: this device opens his profile with his password.
    const hash = await hashPassword('la phrase de Sam', { N: 2 ** 10, r: 8, p: 1 })
    accounts.linkProfile(accounts.create('sam@example.com', hash, clock)!.id, sam.id)
    const openSam = await call('PUT', '/profiles/current', 1, { id: sam.id, password: 'la phrase de Sam' })
    assert.equal(openSam.status, 200)
    const samCookie = openSam.headers.getSetCookie().find(cookie => cookie.startsWith('hodi_profile='))
    opened.set(sam.id, samCookie!.split(';')[0]!)

    // An adult has no limits; a young profile none until its parents set some.
    assert.deepEqual(await (await call('GET', '/me/limits', 1)).json(), { limited: false })
    const free = (await (await call('GET', '/me/limits', zoe.id)).json()) as { limited: boolean; access: string }
    assert.equal(free.limited, true)
    assert.equal(free.access, 'open')

    // Any parent sets them; the young profile itself does not, nor about an adult.
    assert.equal((await call('PUT', `/profiles/${zoe.id}/rules`, zoe.id, { dailyMinutes: 30 })).status, 403)
    assert.equal((await call('GET', `/profiles/${sam.id}/rules`, 1)).status, 404)
    assert.equal((await call('PUT', `/profiles/${zoe.id}/rules`, sam.id, { dailyMinutes: 42 })).status, 400)
    const set = await call('PUT', `/profiles/${zoe.id}/rules`, sam.id, {
      dailyMinutes: 30,
      window: { start: '08:00', end: '20:00' },
      quiet: { start: '20:30', end: '07:30' }
    })
    assert.equal(set.status, 200)
    assert.equal(((await set.json()) as { remainingSeconds: number }).remainingSeconds, 1800)

    // Its heartbeats count the time on screen.
    for (let beat = 0; beat <= 62; beat++) {
      await call('POST', '/me/time', zoe.id)
      clock += 30_000
    }
    const limits = (await (await call('GET', '/me/limits', zoe.id)).json()) as { access: string; opensAt: number }
    assert.equal(limits.access, 'time_up')
    assert.equal(limits.opensAt, Date.UTC(2026, 9, 31, 7))

    const feed = await call('GET', `/feed?tz=${encodeURIComponent(ZONE)}`, zoe.id)
    assert.equal(feed.status, 403)
    assert.equal(((await feed.json()) as { error: string }).error, 'time_up')
    assert.equal((await call('GET', '/topics', zoe.id)).status, 403)
    // Its profile and "Qui lit ?" still answer; an adult reads on.
    assert.equal((await call('GET', '/profiles', zoe.id)).status, 200)
    assert.equal((await call('GET', '/topics', sam.id)).status, 200)

    const week = (await (await call('GET', `/profiles/${zoe.id}/week`, sam.id)).json()) as {
      days: { seconds: number }[]
    }
    assert.ok(week.days.at(-1)!.seconds >= 30 * 60)
  })

  it('counts the time a young profile reads even when its device sends no heartbeat', async () => {
    const leo = profiles.create('Léo', 'nature', clock, { kind: 'teen' })!
    assert.equal((await call('PUT', `/profiles/${leo.id}/rules`, 1, { dailyMinutes: 30 })).status, 200)

    // No POST /me/time: only lists and articles opened, every 30 seconds.
    for (let request = 0; request <= 62; request++) {
      await call('GET', '/topics', leo.id)
      clock += 30_000
    }
    const limits = (await (await call('GET', '/me/limits', leo.id)).json()) as { access: string }
    assert.equal(limits.access, 'time_up')
    assert.equal((await call('GET', '/topics', leo.id)).status, 403)
  })

  it('keeps Résumer, the questions and Résumé du jour for the adults', async () => {
    const max = profiles.create('Max', 'sport', clock, { kind: 'child' })!
    assert.equal((await call('POST', '/articles/abcdefghijklmnop/summary', max.id)).status, 403)
    assert.equal(
      (await call('POST', '/articles/abcdefghijklmnop/question', max.id, { question: 'Pourquoi ?' })).status,
      403
    )
    assert.equal((await call('POST', '/daily-summary', max.id)).status, 403)
    assert.notEqual((await call('POST', '/articles/abcdefghijklmnop/summary', 1)).status, 403)
  })
})

describe('youth sources api', () => {
  const PASSWORD = 'a very long test password'
  const clock = MORNING
  let baseUrl = ''
  let close = () => {}
  let session = ''
  let adminProfile = ''
  const db = openDatabase(':memory:')
  const profiles = new ProfileStore(db)
  const youth = new YouthStore(db, () => ZONE)
  const household = new HouseholdStore(db)
  const users = (profileId: number) => new UserStore(db, profileId)
  const sent: string[] = []
  // One article from each news site: RTL info, which a teen may get, and Le Monde, which none has.
  const DAY = new Date(MORNING - 60 * MINUTE).toUTCString()
  const feeds = fakeFetch({
    'https://rtl.example/feed': rssFeed([
      { title: 'Pluie sur Bruxelles', link: 'https://rtl.example/pluie', date: DAY }
    ]),
    'https://rtl.example/pluie': articlePage('Pluie sur Bruxelles'),
    'https://lemonde.example/feed': rssFeed([
      { title: 'Pluie sur Paris', link: 'https://lemonde.example/pluie', date: DAY }
    ]),
    'https://lemonde.example/pluie': articlePage('Pluie sur Paris')
  })

  const call = (method: string, route: string, profileId: number, body?: unknown) =>
    fetch(`${baseUrl}/api${route}`, {
      method,
      headers: {
        // The admin's own profile opens with its account's password, signed at sign-in; a young one with nothing.
        cookie: `${session}; ${profileId === 1 ? adminProfile : `hodi_profile=${profileId}`}`,
        'Content-Type': 'application/json'
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    })

  // The household follows RTL info and Le Monde; the file adds the young readers' JDE.
  const file = parseCatalog(`
topics:
  - id: world
    label: Monde
    young: [teen, child]
    sources:
      - id: rtl
        name: RTL info
        url: https://rtl.example/feed
        domains: [rtl.example]
        young: [teen]
        young_base: [teen]
      - id: lemonde
        name: Le Monde
        url: https://lemonde.example/feed
        domains: [lemonde.example]
      - id: jde
        name: JDE
        url: https://jde.example/feed
        domains: [jde.example]
        young: [teen, child]
        young_base: [child]
        adults: false
  - id: economie
    label: Économie
    sources: []
`)

  before(async () => {
    const webDir = mkdtempSync(path.join(tmpdir(), 'hodi-web-'))
    writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>Hodi</title>')
    // Every article's made picture is this one file; the route decides who may have it.
    const picture = path.join(webDir, 'picture.webp')
    writeFileSync(picture, 'RIFF-fake-webp')
    const config: Config = {
      host: '127.0.0.1',
      port: 0,
      sessionSecret: Buffer.alloc(32, 4),
      webDir,
      sourcesFile: 'unused.yml',
      databaseFile: ':memory:',
      backupDir: 'unused-backups',
      timeZone: ZONE,
      vapid: { publicKey: 'unused', privateKey: 'unused', subject: 'mailto:test@example.com' }
    }
    household.setUp(
      {
        name: 'Foyer',
        timeZone: ZONE,
        country: null,
        ai: null
      },
      clock
    )
    const catalog = parseCatalog(`
topics:
  - id: world
    label: Monde
    sources:
      - id: rtl
        name: RTL info
        url: https://rtl.example/feed
        domains: [rtl.example]
      - id: lemonde
        name: Le Monde
        url: https://lemonde.example/feed
        domains: [lemonde.example]
  - id: economie
    label: Économie
    sources: []
listen:
  - id: other
    label: Divers
    sources: []
`)
    const alerts = new FollowedAlerts({
      listItems: async () => [],
      send: async target => {
        sent.push(target.endpoint)
      },
      now: () => clock
    })
    const server = createApp(config, {
      ...(await withAdminAccount(db, profiles, PASSWORD, clock)),
      // The suite's clock, so the articles stay in the news window whatever the real date.
      news: new NewsService(catalog, { fetchText: feeds.fetchText, log: () => {}, now: () => clock }),
      alerts,
      profiles,
      users,
      youth,
      household,
      images: { file: async () => picture, inlineFile: async () => picture },
      sources: {
        store: new SourceStore(db),
        file,
        // A blog's feed found from any link but "rien.example"; "rtl.example" finds the feed the household follows;
        // a "youtube.example" link, a channel.
        find: async link =>
          link.includes('rien.example')
            ? { status: 'none' }
            : link.includes('youtube.example')
              ? {
                  status: 'ok',
                  source: {
                    name: 'La Chaîne',
                    url: 'https://youtube.example/feeds/videos.xml?channel_id=UC1',
                    kind: 'video',
                    lang: 'fr',
                    domains: ['youtube.example'],
                    reader: false,
                    origin: 'feed',
                    readable: { tried: 0, ok: 0 },
                    samples: []
                  }
                }
              : {
                  status: 'ok',
                  source: {
                    name: link.includes('rtl') ? 'RTL info' : 'Le Blog',
                    url: `${new URL(link).origin}/feed`,
                    kind: 'article',
                    lang: 'fr',
                    domains: ['blog.example'],
                    reader: true,
                    origin: 'feed',
                    readable: { tried: 3, ok: 3 },
                    samples: []
                  }
                }
      },
      now: () => clock
    }).listen(0)
    await new Promise(resolve => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    close = () => server.close()
    const login = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: PASSWORD })
    })
    ;[session = '', adminProfile = ''] = login.headers.getSetCookie().map(cookie => cookie.split(';')[0]!)
  })

  after(() => close())

  const create = async (name: string, kind: string, by = 1) =>
    (await (await call('POST', '/profiles', by, { name, color: 'sport', kind })).json()) as { id: number }

  it('starts a young profile with its kind’s base sources, and keeps everything else off', async () => {
    const zoe = await create('Zoé', 'teen')
    const max = await create('Max', 'child')

    const teen = (await (await call('GET', `/profiles/${zoe.id}/sources`, 1)).json()) as {
      topics: { id: string; sources: { id: string; on: boolean }[] }[]
    }
    // Only the themes for teens, only the sources for teens: Le Monde is not in its catalogue.
    assert.deepEqual(
      teen.topics.map(topic => topic.id),
      ['world']
    )
    assert.deepEqual(teen.topics[0]!.sources, [
      { id: 'rtl', name: 'RTL info', site: 'https://rtl.example/', on: true },
      { id: 'jde', name: 'JDE', site: 'https://jde.example/', on: false }
    ])

    // The child starts with JDE, brought into the household's catalogue for it and off for everyone else.
    assert.deepEqual(youth.allowedSources(max.id), ['jde'])
    assert.ok(users(1).hiddenSources().includes('jde'))
    assert.ok(users(zoe.id).hiddenSources().includes('jde'))

    const prefs = users(max.id).preferences() as { hiddenSources: string[]; hiddenTopics: string[] }
    assert.deepEqual(prefs.hiddenSources.sort(), ['lemonde', 'rtl'])
    assert.deepEqual(prefs.hiddenTopics, ['economie'])
  })

  it('lets only its parents choose, and keeps their choice whatever its devices send', async () => {
    const zoe = profiles.list().find(profile => profile.name === 'Zoé')!
    assert.equal((await call('PUT', `/profiles/${zoe.id}/sources`, zoe.id, { on: ['lemonde'] })).status, 403)
    assert.equal((await call('PUT', `/profiles/${zoe.id}/sources`, 1, { on: 'rtl' })).status, 400)
    assert.equal((await call('GET', '/profiles/1/sources', 1)).status, 404)

    const set = await call('PUT', `/profiles/${zoe.id}/sources`, 1, { on: ['rtl', 'jde'] })
    assert.equal(set.status, 200)
    assert.deepEqual(youth.allowedSources(zoe.id).sort(), ['jde', 'rtl'])

    // Its own device turns everything on: what its parents left off stays off; what it hides itself, it may.
    const put = await call('PUT', '/me/preferences', zoe.id, {
      preferences: { hiddenSources: ['jde'], hiddenTopics: [] }
    })
    assert.equal(put.status, 200)
    const prefs = users(zoe.id).preferences() as { hiddenSources: string[]; hiddenTopics: string[] }
    assert.deepEqual(prefs.hiddenSources.sort(), ['jde', 'lemonde'])
    assert.deepEqual(prefs.hiddenTopics, ['economie'])

    // Its parents turn a theme off; one it may not see stays out of their list.
    const topics = await call('PUT', `/profiles/${zoe.id}/topics`, 1, { hidden: ['world', 'economie'] })
    assert.deepEqual(((await topics.json()) as { topics: unknown[] }).topics, [
      { id: 'world', label: 'Monde', on: false }
    ])
    assert.deepEqual(youth.hiddenTopics(zoe.id), ['world'])
    await call('PUT', `/profiles/${zoe.id}/topics`, 1, { hidden: [] })
  })

  it('shows a young profile only its sources, and lets it add none', async () => {
    const zoe = profiles.list().find(profile => profile.name === 'Zoé')!
    const listed = (await (await call('GET', '/sources', zoe.id)).json()) as { sources: { id: string }[] }
    assert.deepEqual(listed.sources.map(source => source.id).sort(), youth.allowedSources(zoe.id).sort())
    const adult = (await (await call('GET', '/sources', 1)).json()) as { sources: unknown[] }
    assert.ok(adult.sources.length > listed.sources.length)

    assert.equal((await call('POST', '/sources', zoe.id, { url: 'https://blog.example/' })).status, 403)
    assert.equal((await call('POST', '/sources/suggest', zoe.id, {})).status, 403)
    assert.equal((await call('DELETE', '/sources/rtl', zoe.id)).status, 403)
  })

  it('lists and opens for a young profile only the articles of its sources, whatever it asks the API', async () => {
    const zoe = profiles.list().find(profile => profile.name === 'Zoé')!
    const rtl = itemId('https://rtl.example/pluie')
    const lemonde = itemId('https://lemonde.example/pluie')
    const ids = (body: unknown) => ((body as { items: { id: string }[] }).items ?? []).map(item => item.id).sort()

    // The feeds read once, and each article checked readable.
    await call('GET', '/topics/world?fresh=1', 1)
    await call('GET', `/articles/${rtl}`, 1)
    await call('GET', `/articles/${lemonde}`, 1)

    // An adult finds both; the teen only RTL info's, in the search, the day and the theme.
    assert.deepEqual(ids(await (await call('GET', '/search?q=pluie', 1)).json()), [lemonde, rtl].sort())
    assert.deepEqual(ids(await (await call('GET', '/search?q=pluie', zoe.id)).json()), [rtl])
    const day = `/feed?tz=${encodeURIComponent(ZONE)}`
    assert.deepEqual(ids(await (await call('GET', day, zoe.id)).json()), [rtl])
    assert.deepEqual(ids(await (await call('GET', '/topics/world', zoe.id)).json()), [rtl])
    // A theme its parents did not give it does not answer.
    assert.equal((await call('GET', '/topics/economie', zoe.id)).status, 404)

    // Le Monde's article does not open for it, unless a parent sent it.
    assert.equal((await call('GET', `/articles/${rtl}`, zoe.id)).status, 200)
    assert.equal((await call('GET', `/articles/${lemonde}`, 1)).status, 200)
    assert.equal((await call('GET', `/articles/${lemonde}`, zoe.id)).status, 404)
    // Nor does its picture: the API never hands it what it may not open.
    assert.equal((await call('GET', `/images/${rtl}/240`, zoe.id)).status, 200)
    assert.equal((await call('GET', `/images/${lemonde}/240`, 1)).status, 200)
    assert.equal((await call('GET', `/images/${lemonde}/240`, zoe.id)).status, 404)
    assert.equal((await call('GET', `/images/${lemonde}/1/240`, zoe.id)).status, 404)
    assert.equal((await call('POST', '/me/shares', 1, { articleId: lemonde, to: [zoe.id] })).status, 200)
    assert.equal((await call('GET', `/articles/${lemonde}`, zoe.id)).status, 200)
    assert.equal((await call('GET', `/images/${lemonde}/240`, zoe.id)).status, 200)
    assert.equal((await call('GET', `/images/${lemonde}/1/240`, zoe.id)).status, 200)
  })

  it('lets a teen ask for a source, and its parents accept or refuse it', async () => {
    const zoe = profiles.list().find(profile => profile.name === 'Zoé')!
    const max = profiles.list().find(profile => profile.name === 'Max')!

    // A child asks for nothing; a link without a feed, or a source it already reads, is said so.
    assert.equal((await call('POST', '/me/source-requests', max.id, { url: 'https://blog.example/' })).status, 403)
    assert.equal((await call('POST', '/me/source-requests', zoe.id, { url: 'https://rien.example/' })).status, 422)
    const following = await call('POST', '/me/source-requests', zoe.id, { url: 'https://rtl.example/' })
    assert.equal(following.status, 409)
    assert.equal(((await following.json()) as { error: string }).error, 'following')

    const asked = await call('POST', '/me/source-requests', zoe.id, { url: 'https://blog.example/' })
    assert.equal(asked.status, 201)
    const request = (await asked.json()) as { id: number; status: string; source: { name: string } }
    assert.equal(request.status, 'pending')
    assert.equal(request.source.name, 'Le Blog')
    const again = await call('POST', '/me/source-requests', zoe.id, { url: 'https://blog.example/' })
    assert.equal(((await again.json()) as { error: string }).error, 'pending')
    assert.equal(
      ((await (await call('GET', '/me/source-requests', zoe.id)).json()) as { requests: unknown[] }).requests.length,
      1
    )

    // Only its parents see the requests and answer them.
    assert.equal((await call('GET', '/source-requests', zoe.id)).status, 403)
    assert.equal((await call('POST', `/source-requests/${request.id}`, zoe.id, { accept: true })).status, 403)
    const pending = (await (await call('GET', '/source-requests', 1)).json()) as { requests: { id: number }[] }
    assert.deepEqual(
      pending.requests.map(entry => entry.id),
      [request.id]
    )
    assert.equal(
      (await call('POST', `/source-requests/${request.id}`, 1, { accept: true, topicIds: ['nope'] })).status,
      400
    )

    const accepted = await call('POST', `/source-requests/${request.id}`, 1, { accept: true })
    assert.equal(accepted.status, 200)
    assert.deepEqual(((await accepted.json()) as { requests: unknown[] }).requests, [])
    // In the household's catalogue as the parent's, on for the teen only.
    const blog = youth.allowedSources(zoe.id).find(id => id.startsWith('p1-'))
    assert.equal(blog, 'p1-le-blog')
    assert.ok(users(1).hiddenSources().includes('p1-le-blog'))
    assert.ok(users(max.id).hiddenSources().includes('p1-le-blog'))
    const prefs = users(zoe.id).preferences() as { hiddenSources: string[]; hiddenTopics: string[] }
    assert.ok(!prefs.hiddenSources.includes('p1-le-blog'))
    // Answered once.
    assert.equal((await call('POST', `/source-requests/${request.id}`, 1, { accept: false })).status, 404)

    // A refused request changes nothing.
    const other = (await (
      await call('POST', '/me/source-requests', zoe.id, { url: 'https://autre.example/' })
    ).json()) as { id: number }
    const refused = await call('POST', `/source-requests/${other.id}`, 1, { accept: false })
    assert.equal(refused.status, 200)
    assert.equal(youth.request(other.id)?.status, 'refused')
    assert.equal(youth.allowedSources(zoe.id).length, 3)

    // The teen sees both answers, the latest first, once.
    const answersOf = async (id: number) =>
      (
        (await (await call('GET', '/me/source-requests/answers', id)).json()) as {
          answers: { id: number; status: string }[]
        }
      ).answers
    assert.deepEqual(
      (await answersOf(zoe.id)).map(entry => [entry.id, entry.status]),
      [
        [other.id, 'refused'],
        [request.id, 'accepted']
      ]
    )
    assert.deepEqual(await answersOf(max.id), [])
    assert.equal((await call('POST', '/me/source-requests/answers/seen', zoe.id, { ids: 'x' })).status, 400)
    // Another profile cannot mark them seen.
    await call('POST', '/me/source-requests/answers/seen', max.id, { ids: [other.id, request.id] })
    assert.equal((await answersOf(zoe.id)).length, 2)
    assert.equal(
      (await call('POST', '/me/source-requests/answers/seen', zoe.id, { ids: [other.id, request.id] })).status,
      204
    )
    assert.deepEqual(await answersOf(zoe.id), [])
  })

  it('lets a teen ask for a YouTube channel, which goes to "Vidéos"', async () => {
    const zoe = profiles.list().find(profile => profile.name === 'Zoé')!
    const asked = await call('POST', '/me/source-requests', zoe.id, { url: 'https://youtube.example/@chaine' })
    assert.equal(asked.status, 201)
    const request = (await asked.json()) as { id: number }
    // Its section is one of "Vidéos", not a theme.
    assert.equal(
      (await call('POST', `/source-requests/${request.id}`, 1, { accept: true, topicIds: ['world'] })).status,
      400
    )
    assert.equal((await call('POST', `/source-requests/${request.id}`, 1, { accept: true })).status, 200)
    const channel = youth.allowedSources(zoe.id).find(id => id.startsWith('p1-la-chaine'))
    assert.ok(channel)
    // In its parents' catalogue, under the channels.
    const catalogue = (await (await call('GET', `/profiles/${zoe.id}/sources`, 1)).json()) as {
      topics: { id: string; sources: { id: string; on: boolean }[] }[]
    }
    assert.deepEqual(catalogue.topics.at(-1)?.id, 'channels')
    assert.deepEqual(
      catalogue.topics.at(-1)?.sources.map(source => [source.id, source.on]),
      [[channel, true]]
    )
  })

  it('lets a teen wait for at most three answers at once', async () => {
    const zoe = profiles.list().find(profile => profile.name === 'Zoé')!
    const pending = youth.requests({ profileId: zoe.id, status: 'pending' }).length
    for (let index = pending; index < 3; index++)
      youth.addRequest(
        zoe.id,
        {
          id: '',
          name: `Site ${index}`,
          url: `https://site-${index}.example/`,
          kind: 'article',
          lang: 'fr',
          domains: [],
          reader: true,
          skip: []
        },
        Date.now()
      )
    const full = await call('POST', '/me/source-requests', zoe.id, { url: 'https://blog.example/' })
    assert.equal(full.status, 409)
    assert.equal(((await full.json()) as { error: string }).error, 'full')
  })

  // Last: it deletes Zoé.
  it('drops a teen’s requests with its profile', async () => {
    const zoe = profiles.list().find(profile => profile.name === 'Zoé')!
    assert.ok(youth.requests({ profileId: zoe.id }).length > 0)
    assert.equal((await call('DELETE', `/profiles/${zoe.id}`, 1)).status, 204)
    const left = (await (await call('GET', '/source-requests', 1)).json()) as { requests: { profileId: number }[] }
    assert.deepEqual(
      left.requests.filter(request => request.profileId === zoe.id),
      []
    )
    assert.deepEqual(youth.requests({ profileId: zoe.id }), [])
  })
})
