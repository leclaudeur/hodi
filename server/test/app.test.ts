import assert from 'node:assert/strict'
import sharp from 'sharp'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { createApp } from '../app.ts'
import { GameStore } from '../db/game-store.ts'
import { parseRules } from '../game/rules.ts'
import { LoginThrottle } from '../auth/login-throttle.ts'
import type { Config } from '../config.ts'
import { openDatabase } from '../db/database.ts'
import { HouseholdStore } from '../db/household-store.ts'
import { ProfileStore } from '../db/profile-store.ts'
import { SourceStore } from '../db/source-store.ts'
import { UserStore } from '../db/user-store.ts'
import { parseCatalog } from '../news/catalog.ts'
import { NewsService } from '../news/news-service.ts'
import { SourceIcons } from '../news/source-icons.ts'
import { itemId } from '../news/text.ts'
import { ADMIN_EMAIL, withAdminAccount } from './helpers/accounts.ts'
import { hashPassword } from '../auth/password.ts'
import type { UserAccountStore } from '../db/user-account-store.ts'
import { PNG, articlePage, fakeFetch, rssFeed } from './helpers/news.ts'
import { brotliCompressSync } from 'node:zlib'

const PASSWORD = 'a very long test password'

let baseUrl: string
let close: () => void
let clock = Date.UTC(2026, 9, 23)
let accountStore: UserAccountStore
let news: NewsService
const db = openDatabase(':memory:')
const household = new HouseholdStore(db)

before(async () => {
  const webDir = mkdtempSync(path.join(tmpdir(), 'hodi-web-'))
  writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>Hodi</title>')
  // A picture the server made smaller, for one article at one width.
  const picture = path.join(webDir, 'picture.webp')
  writeFileSync(picture, 'RIFF....WEBPVP8 ')
  mkdirSync(path.join(webDir, 'assets'))
  writeFileSync(path.join(webDir, 'assets', 'index-test.js'), 'export const lines = []\n'.repeat(400))
  // A script the build compressed ahead (vite.config.ts), served as it is: its .br copy says so, to tell them apart.
  writeFileSync(path.join(webDir, 'assets', 'ahead-test.js'), 'export const ahead = []\n'.repeat(400))
  writeFileSync(
    path.join(webDir, 'assets', 'ahead-test.js.br'),
    brotliCompressSync(Buffer.from("export const ahead = 'compressed at build'\n"))
  )
  writeFileSync(path.join(webDir, 'assets', 'cover-test.png'), Buffer.alloc(4096, 7))

  const config: Config = {
    host: '127.0.0.1',
    port: 0,
    sessionSecret: Buffer.alloc(32, 1),
    webDir,
    sourcesFile: 'unused.yml',
    databaseFile: ':memory:',
    backupDir: 'unused-backups',
    timeZone: 'Europe/Brussels',
    vapid: { publicKey: 'unused', privateKey: 'unused', subject: 'mailto:test@example.com' }
  }
  household.setUp(
    {
      name: 'Foyer',
      timeZone: null,
      country: null,
      ai: null
    },
    clock
  )

  const catalog = parseCatalog(`
topics:
  - id: belgium
    label: Belgique
    sources:
      - id: bx1
        name: BX1
        url: https://bx1.be/feed/
        domains: [bx1.be]
  - id: world
    label: Monde
    sources: []
listen:
  - id: actu
    label: Actu
    sources:
      - id: yt-test
        name: Test
        url: https://www.youtube.com/feeds/videos.xml?channel_id=UC123
`)
  const { fetchText, fetchBytes } = fakeFetch({
    'https://bx1.be/feed/': rssFeed([
      { title: 'Bruxelles', link: 'https://bx1.be/bruxelles', date: 'Thu, 22 Oct 2026 10:00:00 +0000' },
      { title: 'Brève', link: 'https://bx1.be/breve', date: 'Thu, 22 Oct 2026 09:00:00 +0000' }
    ]),
    'https://bx1.be/bruxelles': articlePage('Bruxelles'),
    'https://bx1.be/breve': '<html><body><p>Trop court.</p></body></html>',
    'https://bx1.be/': '<html></html>',
    'https://bx1.be/favicon.ico': PNG
  })
  news = new NewsService(catalog, {
    fetchText,
    now: () => clock,
    log: () => {},
    // Two sites: one already followed (bx1.be), one new.
    suggestSources: async () => [
      { name: 'BX1', url: 'https://www.bx1.be/', reason: 'Déjà suivi.' },
      { name: 'Le Blog', url: 'https://blog.example/', reason: 'Un blog sérieux.' }
    ]
  })

  const profiles = new ProfileStore(db)

  const adminStores = await withAdminAccount(db, profiles, PASSWORD, clock)
  accountStore = adminStores.accounts
  const server = createApp(config, {
    news,
    profiles,
    ...adminStores,
    household,
    storage: {
      usage: () => ({ databaseBytes: 1, backupBytes: 0, backups: 0, articles: 0, texts: 0 }),
      clearTexts: () => {}
    },
    users: profileId => new UserStore(db, profileId),
    game: new GameStore(db, parseRules(readFileSync('gamification.yml', 'utf8')), () => 'Europe/Brussels'),
    icons: new SourceIcons(catalog, { fetchText, fetchBytes, now: () => clock, log: () => {} }),
    images: {
      file: async (id, width) => (id === 'PICTUREPICTURE00' && width === 240 ? picture : null),
      inlineFile: async (id, index, width) =>
        id === 'PICTUREPICTURE00' && index === 2 && width === 480 ? picture : null,
      inlineSize: async () => null
    },
    sources: {
      store: new SourceStore(db),
      // A proposal: in the file, not in the catalogue.
      file: parseCatalog(`
topics:
  - id: belgium
    label: Belgique
    sources:
      - id: gazette
        name: La Gazette
        url: https://gazette.example/feed
        domains: [gazette.example]
`),
      // A blog found from any link but "rien.example".
      find: async link =>
        link.includes('rien.example')
          ? { status: 'none' }
          : {
              status: 'ok',
              source: {
                name: 'Le Blog',
                url: link.includes('video')
                  ? 'https://www.youtube.com/feeds/videos.xml?channel_id=UCx'
                  : link.includes('gazette')
                    ? 'https://gazette.example/rss'
                    : 'https://blog.example/feed',
                kind: link.includes('video') ? 'video' : 'article',
                lang: 'fr',
                domains: ['blog.example'],
                reader: true,
                origin: link.includes('video') ? 'youtube' : 'feed',
                readable: { tried: 3, ok: 3 },
                samples: ['Premier']
              }
            }
    },
    now: () => clock,
    throttle: new LoginThrottle(3, 60_000)
  }).listen(0)
  await new Promise(resolve => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  close = () => server.close()
})

after(() => close())

const MEMBER_PASSWORD = 'le mot de passe du membre'
let adults = 0

// Every adult profile opens with its own account's password: an adult made here gets an account, then this device
// opens its profile, signed in with that account from then on.
const openAdult = async (session: string, id: number) => {
  if (!accountStore.ofProfile(id)) {
    const hash = await hashPassword(MEMBER_PASSWORD, { N: 2 ** 10, r: 8, p: 1 })
    accountStore.linkProfile(accountStore.create(`adult-${++adults}@example.com`, hash, clock)!.id, id)
  }
  const opened = await fetch(`${baseUrl}/api/profiles/current`, {
    method: 'PUT',
    headers: { cookie: session, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, password: MEMBER_PASSWORD })
  })
  assert.equal(opened.status, 200)
  return sessionCookieFrom(opened)
}

const login = (password: string) =>
  fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password })
  })

// The session and, after a sign-in, the account's own profile it opens: every adult profile asks for its password,
// so the session alone opens nothing.
const sessionCookieFrom = (response: Response) =>
  response.headers
    .getSetCookie()
    .map(cookie => cookie.split(';')[0])
    .join('; ')

describe('app', () => {
  it('serves a public health endpoint with security headers', async () => {
    const response = await fetch(`${baseUrl}/health`)

    assert.equal(response.status, 200)
    const body = (await response.json()) as { status: string; boot: string }
    assert.equal(body.status, 'ok')
    // The same on each answer until Hodi restarts.
    assert.match(body.boot, /^[0-9a-f]{16}$/)
    assert.equal(((await (await fetch(`${baseUrl}/health`)).json()) as { boot: string }).boot, body.boot)
    assert.match(response.headers.get('content-security-policy') ?? '', /default-src 'self'/)
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow')
    assert.equal(response.headers.get('x-powered-by'), null)
  })

  it('serves the web app shell without a session', async () => {
    const response = await fetch(`${baseUrl}/some/client/route`)

    assert.equal(response.status, 200)
    assert.match(await response.text(), /<title>Hodi<\/title>/)
  })

  it('compresses text responses for clients that accept it, ahead of time for the bundle, but not images', async () => {
    const brotli = await fetch(`${baseUrl}/assets/index-test.js`, { headers: { 'Accept-Encoding': 'br, gzip' } })
    assert.equal(brotli.headers.get('content-encoding'), 'br')
    assert.match(brotli.headers.get('vary') ?? '', /Accept-Encoding/i)
    assert.match(await brotli.text(), /export const lines/)

    const gzip = await fetch(`${baseUrl}/assets/index-test.js`, { headers: { 'Accept-Encoding': 'gzip' } })
    assert.equal(gzip.headers.get('content-encoding'), 'gzip')
    await gzip.arrayBuffer()

    const plain = await fetch(`${baseUrl}/assets/index-test.js`, { headers: { 'Accept-Encoding': 'identity' } })
    assert.equal(plain.headers.get('content-encoding'), null)
    await plain.arrayBuffer()

    const ahead = await fetch(`${baseUrl}/assets/ahead-test.js`, { headers: { 'Accept-Encoding': 'gzip, br' } })
    assert.equal(ahead.headers.get('content-encoding'), 'br')
    assert.match(ahead.headers.get('content-type') ?? '', /javascript/)
    assert.equal(ahead.headers.get('cache-control'), 'public, max-age=31536000, immutable')
    assert.equal(await ahead.text(), "export const ahead = 'compressed at build'\n")

    const image = await fetch(`${baseUrl}/assets/cover-test.png`, { headers: { 'Accept-Encoding': 'br, gzip' } })
    assert.equal(image.headers.get('content-encoding'), null)
    await image.arrayBuffer()
  })

  it('rejects API calls without a valid session', async () => {
    for (const cookie of ['', 'hodi_session=v1.9999999999.forged']) {
      const response = await fetch(`${baseUrl}/api/session`, { headers: { cookie } })

      assert.equal(response.status, 401)
      assert.equal(response.headers.get('cache-control'), 'no-store')
    }

    assert.equal((await fetch(`${baseUrl}/api/unknown`)).status, 401)
  })

  it('validates the login body', async () => {
    const response = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"password": 42}'
    })

    assert.equal(response.status, 400)
    assert.equal((await login('x'.repeat(300))).status, 400)
  })

  it('logs in, opens a session and logs out', async () => {
    const response = await login(PASSWORD)

    assert.equal(response.status, 204)
    assert.match(response.headers.get('set-cookie') ?? '', /HttpOnly; Secure; SameSite=Lax/)

    const cookie = sessionCookieFrom(response)
    const session = await fetch(`${baseUrl}/api/session`, { headers: { cookie } })

    assert.equal(session.status, 200)
    // The account's own profile opens at once.
    assert.deepEqual(await session.json(), { authenticated: true, profileChosen: true, language: 'fr', hourCycle: 24 })
    assert.equal((await fetch(`${baseUrl}/api/unknown`, { headers: { cookie } })).status, 404)

    const logout = await fetch(`${baseUrl}/api/logout`, { method: 'POST', headers: { cookie } })

    assert.equal(logout.status, 204)
    assert.match(logout.headers.get('set-cookie') ?? '', /hodi_session=; Max-Age=0/)
  })

  it('expires sessions after their lifetime', async () => {
    const cookie = sessionCookieFrom(await login(PASSWORD))
    const savedClock = clock

    clock += 91 * 24 * 60 * 60 * 1000
    const response = await fetch(`${baseUrl}/api/session`, { headers: { cookie } })
    clock = savedClock

    assert.equal(response.status, 401)
  })

  it('serves topics, listen items, source statuses and articles to a session', async () => {
    const cookie = sessionCookieFrom(await login(PASSWORD))
    const get = (route: string) => fetch(`${baseUrl}/api${route}`, { headers: { cookie } })

    assert.equal((await get('/topics/belgium')).status, 200)
    assert.deepEqual(await (await get('/topics')).json(), {
      topics: [
        { id: 'belgium', label: 'Belgique', sources: [{ id: 'bx1', name: 'BX1' }] },
        { id: 'world', label: 'Monde', sources: [] }
      ]
    })
    assert.equal((await get('/topics/nope')).status, 404)
    assert.equal((await get('/topics/belgium?limit=0')).status, 400)
    assert.equal((await get('/topics/belgium?limit=abc')).status, 400)

    // The first listing starts the background checks: only readable articles are listed afterwards.
    await news.whenChecksIdle()
    const topic = (await (await get('/topics/belgium')).json()) as {
      checking: number
      items: { title: string; access: string }[]
    }

    assert.equal(topic.checking, 0)
    assert.deepEqual(
      topic.items.map(item => [item.title, item.access]),
      [['Bruxelles', 'reader']]
    )
    assert.equal((topic.items[0] as { readingMinutes?: number }).readingMinutes, 1)

    const article = await get(`/articles/${itemId('https://bx1.be/bruxelles')}`)
    const body = (await article.json()) as { status: string; article: { contentHtml: string }; canSummarize: boolean }

    assert.equal(article.status, 200)
    assert.equal(body.status, 'ok')
    assert.match(body.article.contentHtml, /Paragraph 1/)

    assert.deepEqual(
      ((await (await get(`/articles/${itemId('https://bx1.be/breve')}`)).json()) as { status: string }).status,
      'unreadable'
    )
    assert.equal((await get('/articles/AAAAAAAAAAAAAAAA')).status, 404)
    assert.equal((await get('/articles/not-an-id')).status, 404)

    // Without an API key the app offers no summaries.
    assert.equal(body.canSummarize, false)
    const summary = await fetch(`${baseUrl}/api/articles/${itemId('https://bx1.be/bruxelles')}/summary`, {
      method: 'POST',
      headers: { cookie }
    })
    assert.equal(summary.status, 503)

    const ask = (body: unknown) =>
      fetch(`${baseUrl}/api/articles/${itemId('https://bx1.be/bruxelles')}/question`, {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
    assert.equal((await ask({ question: 'Qui ?' })).status, 503)
    assert.equal((await ask({ question: '  ' })).status, 400)
    assert.equal((await ask({ question: 'x'.repeat(301) })).status, 400)
    assert.equal((await ask({})).status, 400)

    const frontPage = (await (await get('/front-page')).json()) as {
      sections: { id: string; items: { title: string }[] }[]
    }
    assert.deepEqual(
      frontPage.sections.map(section => [section.id, section.items.map(item => item.title)]),
      [['belgium', ['Bruxelles']]]
    )

    // Seen stories step aside, but a topic with nothing newer still shows them.
    const seen = (ids: unknown) =>
      fetch(`${baseUrl}/api/me/stories/seen`, {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids })
      })
    const story = (frontPage.sections[0]?.items[0] as { id?: string } | undefined)?.id ?? ''
    assert.equal((await seen([story])).status, 204)
    assert.equal((await seen([])).status, 400)
    const again = (await (await get('/front-page')).json()) as typeof frontPage
    assert.deepEqual(
      again.sections[0]?.items.map(item => item.title),
      ['Bruxelles']
    )

    const engagement = (await (await get('/sources/engagement')).json()) as {
      days: number
      sources: { id: string; low: boolean }[]
    }
    assert.equal(engagement.days, 30)
    assert.ok(engagement.sources.length > 0 && engagement.sources.every(source => !source.low))

    assert.deepEqual(await (await get('/daily-summary')).json(), { status: 'unavailable' })
    const written = await fetch(`${baseUrl}/api/daily-summary`, { method: 'POST', headers: { cookie } })
    assert.deepEqual(await written.json(), { status: 'unavailable' })

    const search = (await (await get('/search?q=bruxelles')).json()) as {
      items: { title: string; topicLabel: string }[]
    }
    assert.deepEqual(
      search.items.map(item => [item.title, item.topicLabel]),
      [['Bruxelles', 'Belgique']]
    )
    assert.equal((await get('/search')).status, 400)
    assert.ok(Array.isArray(((await (await get('/trends')).json()) as { trends: unknown[] }).trends))
    assert.deepEqual(
      ((await (await get('/ai-usage')).json()) as { kinds: { kind: string; used: number }[] }).kinds.map(
        ({ kind, used }) => [kind, used]
      ),
      [
        ['summary', 0],
        ['question', 0],
        ['dailySummary', 0],
        ['sources', 0],
        ['plugin', 0]
      ]
    )

    // Nothing today (the 23rd): "Le fil" opens on the 22nd.
    const day = (await (await get('/feed?tz=Europe/Brussels')).json()) as {
      day: string
      items: { title: string; topicId: string }[]
      previousDay: string | null
    }
    assert.deepEqual(
      [day.day, day.items.map(item => [item.title, item.topicId]), day.previousDay],
      ['2026-10-22', [['Bruxelles', 'belgium']], null]
    )
    const belgique = (await (await get('/feed?tz=Europe/Brussels&topic=belgium')).json()) as { day: string }
    assert.equal(belgique.day, '2026-10-22')
    for (const query of [
      '',
      '?tz=Mars/Olympus',
      '?tz=UTC&day=2026-13-01',
      '?tz=UTC&day=2099-01-01',
      '?tz=UTC&topic=nope'
    ]) {
      assert.equal((await get(`/feed${query}`)).status, 400, query)
    }

    const icon = await get('/sources/bx1/icon')
    assert.equal(icon.status, 200)
    assert.equal(icon.headers.get('content-type'), 'image/png')
    assert.equal(icon.headers.get('cache-control'), 'private, max-age=604800')
    assert.equal((await get('/sources/nope/icon')).status, 404)
    assert.equal((await get(`/search?q=${'x'.repeat(101)}`)).status, 400)

    const listen = (await (await get('/listen')).json()) as {
      sections: { id: string; label: string; items: unknown[] }[]
      sources: { id: string; ok: boolean }[]
    }
    assert.deepEqual(listen.sections, [{ id: 'actu', label: 'Actu', items: [] }])
    assert.deepEqual(listen.sources, [
      {
        id: 'yt-test',
        name: 'Test',
        kind: 'video',
        lang: 'fr',
        site: 'https://www.youtube.com/channel/UC123',
        ok: false,
        itemCount: 0,
        fetchedAt: null,
        error: 'HTTP 404'
      }
    ])

    const sources = (await (await get('/sources')).json()) as { sources: { id: string; ok: boolean }[] }
    assert.deepEqual(
      sources.sources.map(source => [source.id, source.ok]),
      [
        ['bx1', true],
        ['yt-test', false]
      ]
    )
  })

  it('serves an article picture made smaller, cached, and nothing for any other', async () => {
    const cookie = sessionCookieFrom(await login(PASSWORD))

    const found = await fetch(`${baseUrl}/api/images/PICTUREPICTURE00/240`, { headers: { cookie } })
    assert.equal(found.status, 200)
    assert.equal(found.headers.get('content-type'), 'image/webp')
    assert.equal(found.headers.get('cache-control'), 'private, max-age=604800, immutable')
    await found.arrayBuffer()

    const inline = await fetch(`${baseUrl}/api/images/PICTUREPICTURE00/2/480`, { headers: { cookie } })
    assert.equal(inline.status, 200)
    assert.equal(inline.headers.get('content-type'), 'image/webp')
    await inline.arrayBuffer()

    for (const route of [
      '/images/PICTUREPICTURE00/960',
      '/images/OTHERARTICLE0000/240',
      '/images/..%2F..%2Fetc/240',
      '/images/PICTUREPICTURE00/1/480',
      '/images/PICTUREPICTURE00/-2/480',
      '/images/PICTUREPICTURE00/2000/480'
    ]) {
      const response = await fetch(`${baseUrl}/api${route}`, { headers: { cookie } })
      assert.equal(response.status, 404)
      await response.arrayBuffer()
    }
  })

  it('requires a session for news routes', async () => {
    for (const route of [
      '/topics',
      '/topics/belgium',
      '/front-page',
      '/daily-summary',

      '/search?q=x',
      '/listen',
      '/sources',
      '/feed?tz=UTC',
      '/sources/bx1/icon',
      '/images/AAAAAAAAAAAAAAAA/240',
      '/images/AAAAAAAAAAAAAAAA/0/480',
      '/articles/AAAAAAAAAAAAAAAA'
    ]) {
      assert.equal((await fetch(`${baseUrl}/api${route}`)).status, 401)
    }

    assert.equal((await fetch(`${baseUrl}/api/articles/AAAAAAAAAAAAAAAA/summary`, { method: 'POST' })).status, 401)
    assert.equal((await fetch(`${baseUrl}/api/daily-summary`, { method: 'POST' })).status, 401)
  })

  it('throttles repeated failed logins, even for the right password', async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      assert.equal((await login('wrong password')).status, 401)
    }

    const blocked = await login(PASSWORD)

    assert.equal(blocked.status, 429)
    assert.equal(blocked.headers.get('retry-after'), '60')
  })

  it('keeps the throttle per client, so another visitor behind the proxy still signs in', async () => {
    const fromElsewhere = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.9' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: PASSWORD })
    })

    assert.equal(fromElsewhere.status, 204)
  })
})

describe('reader state', () => {
  const ID = 'abcdefghijklmnop'
  let cookie = ''
  const call = (method: string, route: string, body?: unknown) =>
    fetch(`${baseUrl}/api/me${route}`, {
      method,
      headers: { cookie, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    })

  before(async () => {
    // The throttling test above blocked logins for a minute.
    clock += 2 * 60_000
    cookie = sessionCookieFrom(await login(PASSWORD))
  })

  it('shares preferences, saved and read articles between devices, with a revision', async () => {
    const empty = (await (await call('GET', '/')).json()) as { revision: number; saved: unknown[] }
    assert.equal(empty.saved.length, 0)

    assert.equal(
      (
        await call('PUT', '/preferences', {
          preferences: { theme: 'powder', accent: 'bleu', mutedWords: ['foot'], junk: 1 }
        })
      ).status,
      200
    )
    assert.equal((await call('PUT', `/saved/${ID}`, { item: { id: ID, title: 'Sommet' } })).status, 200)
    const { revision } = (await (await call('POST', '/read', { ids: [ID] })).json()) as { revision: number }

    const state = (await (await call('GET', '/')).json()) as {
      revision: number
      preferences: Record<string, unknown>
      saved: { item: { title: string } }[]
      read: string[]
    }
    assert.equal(state.revision, revision)
    assert.deepEqual(state.preferences, { theme: 'powder', accent: 'bleu', mutedWords: ['foot'] })
    assert.equal(state.saved[0]?.item.title, 'Sommet')
    assert.deepEqual(state.read, [ID])

    // Nothing changed since: nothing to send.
    assert.equal((await call('GET', `/?since=${revision}`)).status, 204)

    // A device from before the topics' ids were English still sends its accent by the old name.
    assert.equal((await call('PUT', '/preferences', { preferences: { accent: 'monde' } })).status, 200)

    // A device from before every id was English sends Poudré by its old name: it is kept under the new one.
    assert.equal((await call('PUT', '/preferences', { preferences: { theme: 'poudre' } })).status, 200)
    const renamed = (await (await call('GET', '/')).json()) as { preferences: Record<string, unknown> }
    assert.equal(renamed.preferences.theme, 'powder')
    assert.equal(
      (
        await call('PUT', '/preferences', {
          preferences: { theme: 'powder', accent: 'bleu', mutedWords: ['foot'] }
        })
      ).status,
      200
    )
  })

  it('keeps a profile’s own interface language, or none for the household’s', async () => {
    assert.equal((await call('PUT', '/preferences', { preferences: { language: 'nl' } })).status, 400)
    assert.equal((await call('PUT', '/preferences', { preferences: { language: 'en' } })).status, 200)
    const chosen = (await (await call('GET', '/')).json()) as { preferences: Record<string, unknown> }
    assert.equal(chosen.preferences.language, 'en')
    assert.equal((await call('PUT', '/preferences', { preferences: { language: null } })).status, 200)
    const reset = (await (await call('GET', '/')).json()) as { preferences: Record<string, unknown> }
    assert.equal(reset.preferences.language, null)
  })

  it('merges a preferences change, so a device with an older copy keeps the rest', async () => {
    assert.equal((await call('PUT', '/preferences', { preferences: { followedWords: ['Courtois'] } })).status, 200)
    assert.equal((await call('PUT', '/preferences', { preferences: { hideRead: true } })).status, 200)

    const { preferences } = (await (await call('GET', '/')).json()) as { preferences: Record<string, unknown> }
    assert.deepEqual(preferences.followedWords, ['Courtois'])
    assert.deepEqual(preferences.mutedWords, ['foot'])
    assert.equal(preferences.hideRead, true)
  })

  it('marks an article unread again, or forgets the whole history', async () => {
    const other = 'abcdefghij012345'
    await call('POST', '/read', { ids: [ID, other] })
    assert.equal((await call('DELETE', `/read/${other}`)).status, 200)
    assert.deepEqual(((await (await call('GET', '/')).json()) as { read: string[] }).read, [ID])

    // Articles the feeds don't know are left out of the history's cards.
    assert.deepEqual(await (await call('GET', '/history')).json(), { items: [] })

    assert.equal((await call('DELETE', '/read')).status, 200)
    assert.deepEqual(((await (await call('GET', '/')).json()) as { read: string[] }).read, [])
    assert.equal((await call('DELETE', '/read/../etc')).status, 404)
  })

  it('hides an article without opening it, and keeps an opened one as read', async () => {
    const other = 'abcdefghij012345'
    await call('POST', '/read', { ids: [ID] })
    await call('POST', '/read', { ids: [ID, other], hidden: true })
    await call('POST', '/read', { ids: [other] })

    const state = (await (await call('GET', '/')).json()) as { read: string[]; hidden: string[] }
    assert.deepEqual([...state.read].sort(), [ID, other].sort())
    assert.deepEqual([...state.hidden].sort(), [ID, other].sort())

    // Unread again: back in the lists.
    await call('DELETE', `/read/${other}`)
    assert.deepEqual(((await (await call('GET', '/')).json()) as { hidden: string[] }).hidden, [ID])
  })

  it('rejects malformed state', async () => {
    assert.equal((await call('PUT', '/preferences', { preferences: { theme: 'pink' } })).status, 400)
    assert.equal((await call('PUT', '/preferences', { preferences: { accent: 'fuchsia' } })).status, 400)
    // The accent colours are the profile colours.
    assert.equal((await call('PUT', '/preferences', { preferences: { accent: 'sport' } })).status, 200)
    assert.equal((await call('PUT', `/saved/${ID}`, { item: { id: 'other-id-1234567' } })).status, 400)
    assert.equal((await call('POST', '/read', { ids: ['../etc'] })).status, 400)
  })

  it('imports a device state without replacing what is there, and serves a saved article text', async () => {
    const other = 'qrstuvwxyz012345'
    const response = await call('POST', '/import', {
      preferences: { theme: 'dark' },
      saved: [
        {
          item: { id: other, title: 'Ancien' },
          article: { title: 'Ancien', contentHtml: '<p>Texte</p>' },
          savedAt: '2026-10-01T10:00:00.000Z'
        }
      ],
      read: [other],
      readings: [{ id: other, sourceId: 'bx1', sourceName: 'BX1', minutes: 3, at: clock }]
    })
    assert.equal(response.status, 200)

    const state = (await (await call('GET', '/')).json()) as {
      preferences: Record<string, unknown>
      saved: unknown[]
      readings: unknown[]
    }
    assert.equal(state.preferences.theme, 'powder')
    assert.equal(state.saved.length, 2)
    assert.equal(state.readings.length, 1)

    const article = await fetch(`${baseUrl}/api/articles/${other}`, { headers: { cookie } })
    assert.equal(article.status, 200)
    assert.equal(((await article.json()) as { article: { contentHtml: string } }).article.contentHtml, '<p>Texte</p>')
  })

  it('keeps whether a reading is an article or a video, and refuses another kind', async () => {
    const video = 'vvvvvvvvvvvvvvvv'
    const post = (kind: unknown) =>
      call('POST', '/readings', {
        readings: [{ id: video, sourceId: 'yt', sourceName: 'YT', minutes: 12, at: clock, kind }]
      })
    assert.equal((await post('film')).status, 400)
    assert.equal((await post('video')).status, 200)

    const state = (await (await call('GET', '/')).json()) as { readings: { id: string; kind: string }[] }
    assert.equal(state.readings.find(reading => reading.id === video)?.kind, 'video')
  })

  it('tracks how much of an article was read, never less than before, and leaves older readings alone', async () => {
    const article = 'pppppppppppppppp'
    const legacy = 'llllllllllllllll'
    await call('POST', '/readings', {
      readings: [
        { id: article, sourceId: 'bx1', sourceName: 'BX1', minutes: 0, at: clock, done: false, estimate: 6 },
        { id: legacy, sourceId: 'bx1', sourceName: 'BX1', minutes: 4, at: clock }
      ]
    })
    const patch = (id: string, body: unknown) => call('PATCH', `/readings/${id}`, body)
    assert.equal((await patch(article, { minutes: 1.24, progress: 0.5, position: 0.5, done: false })).status, 200)
    assert.equal((await patch(article, { minutes: 0.5, progress: 0.3, position: 0.3, done: false })).status, 200)
    assert.equal((await patch(article, { minutes: 1, progress: 2, position: 0, done: true })).status, 400)
    assert.equal((await patch(legacy, { minutes: 9, progress: 1, position: 1, done: false })).status, 200)

    type Entry = {
      id: string
      minutes: number
      done?: boolean
      progress?: number
      position?: number
      estimate?: number
    }
    const state = (await (await call('GET', '/')).json()) as { readings: Entry[] }
    const tracked = state.readings.find(reading => reading.id === article)
    assert.deepEqual(
      { minutes: tracked?.minutes, done: tracked?.done, progress: tracked?.progress, position: tracked?.position },
      { minutes: 1.2, done: false, progress: 0.5, position: 0.3 }
    )
    assert.equal(tracked?.estimate, 6)
    const older = state.readings.find(reading => reading.id === legacy)
    assert.equal(older?.minutes, 4)
    assert.equal(older?.done, undefined)

    await patch(article, { minutes: 3, progress: 0.9, position: 0.9, done: true })
    await patch(article, { minutes: 3, progress: 0.9, position: 0.9, done: false })
    const after = (await (await call('GET', '/')).json()) as { readings: Entry[] }
    assert.equal(after.readings.find(reading => reading.id === article)?.done, true)
  })

  it('gives points for what is read, and shows the level reached', async () => {
    type Game = { points: number; level: number; name: string; week: number; next: { name: string } | null }
    const before = (await (await call('GET', '/game')).json()) as Game
    // An article no feed listed earns nothing, whatever the device says of it.
    await call('POST', '/readings', {
      readings: [
        { id: 'gggggggggggggggg', sourceId: 'bx1', sourceName: 'BX1', topicId: 'culture', minutes: 3, at: clock }
      ]
    })
    assert.equal(((await (await call('GET', '/game')).json()) as Game).points, before.points)
    // BX1's article, in Belgique whatever theme the device names: 10, and 5 for the first one of the day there.
    await call('POST', '/readings', {
      readings: [
        {
          id: itemId('https://bx1.be/bruxelles'),
          sourceId: 'bx1',
          sourceName: 'BX1',
          topicId: 'culture',
          minutes: 3,
          at: clock
        }
      ]
    })
    const after = (await (await call('GET', '/game')).json()) as Game
    assert.equal(after.points, before.points + 15)
    assert.equal(after.week, before.week + 15)
    assert.equal(after.level, 1)
    assert.equal(after.next?.name, 'Lecteur')
  })

  it('counts a reading finished offline on the day the device says', async () => {
    type Game = { points: number }
    const before = (await (await call('GET', '/game')).json()) as Game
    const id = itemId('https://bx1.be/breve')
    const yesterday = clock - 24 * 60 * 60 * 1000
    await call('POST', '/readings', {
      readings: [
        {
          id,
          sourceId: 'bx1',
          sourceName: 'BX1',
          topicId: 'culture',
          minutes: 1,
          at: yesterday,
          done: false,
          progress: 0.1,
          position: 0.1
        }
      ]
    })
    await call('PATCH', `/readings/${id}`, { minutes: 4, progress: 0.9, position: 0.9, done: true, at: yesterday })
    const after = (await (await call('GET', '/game')).json()) as Game
    // 10, and 5 for yesterday's first article in Belgique (today's was earned already).
    assert.equal(after.points, before.points + 15)
  })

  it('shows the household week, the badges, and lets the admin turn the game off', async () => {
    const api = (method: string, route: string, body?: unknown) =>
      fetch(`${baseUrl}/api${route}`, {
        method,
        headers: { cookie, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      })
    const week = (await (await api('GET', '/game')).json()) as {
      enabled: boolean
      challenge: { goal: number; read: number }
      ranking: { profileId: number; week: number }[]
    }
    assert.equal(week.enabled, true)
    assert.equal(week.challenge.goal, 30)
    assert.ok(week.ranking.length > 0 && (week.ranking[0]?.week ?? 0) > 0)

    const mine = (await (await call('GET', '/game')).json()) as { badges: { id: string; tier: number }[] }
    assert.equal(mine.badges.length, 10)
    // Nothing earned that far: no badge to wear.
    assert.equal((await call('PUT', '/game/badge', { badge: 'encyclopedia' })).status, 400)
    assert.equal((await call('PUT', '/game/badge', { badge: null })).status, 200)
    assert.equal((await call('POST', '/game/alerts', { articleId: 'aaaaaaaaaaaaaaaa' })).status, 204)
    assert.deepEqual((mine as unknown as { news: unknown }).news, { level: null, badges: [] })
    assert.equal((await call('POST', '/game/seen')).status, 204)
    assert.equal((await api('GET', '/game/profiles/999')).status, 404)

    assert.equal((await api('PUT', '/game/enabled', { enabled: false })).status, 200)
    assert.equal(((await (await api('GET', '/game')).json()) as { enabled: boolean }).enabled, false)
    assert.equal((await api('PUT', '/game/enabled', { enabled: true })).status, 200)
  })
})

describe('profiles', () => {
  let session = ''
  const call = (method: string, route: string, { body, cookie = session }: { body?: unknown; cookie?: string } = {}) =>
    fetch(`${baseUrl}/api${route}`, {
      method,
      headers: { cookie, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    })

  before(async () => {
    clock += 2 * 60_000
    session = sessionCookieFrom(await login(PASSWORD))
  })

  it('asks "Qui lit ?" until the device picks a profile, then keeps each profile’s state apart', async () => {
    const signedInOnly = session.split('; ')[0]!
    assert.deepEqual(await (await call('GET', '/session', { cookie: signedInOnly })).json(), {
      authenticated: true,
      profileChosen: false,
      language: 'fr',
      hourCycle: 24
    })

    const created = await call('POST', '/profiles', { body: { name: '  Léa ', color: 'science' } })
    assert.equal(created.status, 201)
    const lea = (await created.json()) as { id: number; name: string }
    assert.equal(lea.name, 'Léa')

    const asLea = await openAdult(session, lea.id)
    assert.match(asLea, new RegExp(`hodi_profile=${lea.id}\\.[\\w-]+`))

    assert.deepEqual(await (await call('GET', '/session', { cookie: asLea })).json(), {
      authenticated: true,
      profileChosen: true,
      language: 'fr',
      hourCycle: 24
    })
    const list = (await (await call('GET', '/profiles', { cookie: asLea })).json()) as {
      profiles: { name: string }[]
      current: number
    }
    assert.deepEqual(
      list.profiles.map(entry => entry.name),
      ['Admin', 'Léa']
    )
    assert.equal(list.current, lea.id)

    const ID = 'lealeaonlyarticl'
    await call('PUT', `/me/saved/${ID}`, { body: { item: { id: ID, title: 'Pour Léa' } }, cookie: asLea })
    const leaState = (await (await call('GET', '/me', { cookie: asLea })).json()) as { saved: unknown[] }
    const anthoState = (await (await call('GET', '/me')).json()) as { saved: { item: { id: string } }[] }
    assert.equal(leaState.saved.length, 1)
    assert.ok(!anthoState.saved.some(entry => entry.item.id === ID))

    // A profile that no longer exists, or never did: the first one.
    const stale = `${session}; hodi_profile=999`
    assert.equal(((await (await call('GET', '/profiles', { cookie: stale })).json()) as { current: number }).current, 1)
  })

  it('lets a profile send articles only to the profiles that share', async () => {
    const list = (await (await call('GET', '/profiles')).json()) as { profiles: { id: number; name: string }[] }
    const lea = list.profiles.find(profile => profile.name === 'Léa')!
    const targets = async () =>
      ((await (await call('GET', '/me/share-targets')).json()) as { profiles: number[] }).profiles
    assert.deepEqual(await targets(), [lea.id])

    const asLea = await openAdult(session, lea.id)
    await call('PUT', '/me/preferences', { body: { preferences: { sharing: false } }, cookie: asLea })

    assert.deepEqual(await targets(), [])
    const sent = await call('POST', '/me/shares', { body: { articleId: 'abcdefghijklmnop', to: [lea.id] } })
    assert.equal(sent.status, 400)
    assert.deepEqual(await (await call('GET', '/me/shares', { cookie: asLea })).json(), { items: [] })

    await call('PUT', '/me/preferences', { body: { preferences: { sharing: true } }, cookie: asLea })
    assert.deepEqual(await targets(), [lea.id])
  })

  it('opens a new profile on its tour once, on whichever device it is first opened', async () => {
    const list = (await (await call('GET', '/profiles')).json()) as {
      profiles: { id: number; name: string; tourPending: boolean }[]
    }
    const lea = list.profiles.find(profile => profile.name === 'Léa')!
    assert.equal(lea.tourPending, true)
    assert.equal(list.profiles.find(profile => profile.name === 'Admin')!.tourPending, false)

    // Not the admin's to take for her.
    assert.equal((await call('POST', `/profiles/${lea.id}/tour`)).status, 403)

    const asLea = await openAdult(session, lea.id)
    const taken = await call('POST', `/profiles/${lea.id}/tour`, { cookie: asLea })
    assert.equal(((await taken.json()) as { tourPending: boolean }).tourPending, false)
  })

  it('keeps a photo under an address that changes with it', async () => {
    const photo = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#c4673a' } })
      .webp()
      .toBuffer()
    const put = await fetch(`${baseUrl}/api/profiles/1/photo`, {
      method: 'PUT',
      headers: { cookie: session, 'Content-Type': 'image/webp' },
      body: photo
    })
    const { photoVersion } = (await put.json()) as { photoVersion: number }
    assert.equal(photoVersion, clock)

    const got = await call('GET', `/profiles/1/photo?v=${photoVersion}`)
    assert.equal(got.headers.get('content-type'), 'image/webp')
    assert.match(got.headers.get('cache-control') ?? '', /immutable/)
    assert.deepEqual(Buffer.from(await got.arrayBuffer()), photo)

    const wrongType = await fetch(`${baseUrl}/api/profiles/1/photo`, {
      method: 'PUT',
      headers: { cookie: session, 'Content-Type': 'image/svg+xml' },
      body: '<svg/>'
    })
    assert.equal(wrongType.status, 400)

    // Said to be a picture, but not one: an SVG or a page could run as one if it were served back.
    const disguised = await fetch(`${baseUrl}/api/profiles/1/photo`, {
      method: 'PUT',
      headers: { cookie: session, 'Content-Type': 'image/png' },
      body: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    })
    assert.equal(disguised.status, 400)
    // A real picture under another picture's type.
    const mislabelled = await fetch(`${baseUrl}/api/profiles/1/photo`, {
      method: 'PUT',
      headers: { cookie: session, 'Content-Type': 'image/jpeg' },
      body: photo
    })
    assert.equal(mislabelled.status, 400)

    assert.equal(
      ((await (await call('DELETE', '/profiles/1/photo')).json()) as { photoVersion: null }).photoVersion,
      null
    )
    assert.equal((await call('GET', '/profiles/1/photo')).status, 404)
  })

  it('leaves a member its own profile only, and the household to the admin', async () => {
    const zoe = (await (await call('POST', '/profiles', { body: { name: 'Zoé', color: 'ai' } })).json()) as {
      id: number
      role: string
    }
    assert.equal(zoe.role, 'member')
    const asZoe = await openAdult(session, zoe.id)

    assert.equal((await call('PATCH', `/profiles/${zoe.id}`, { body: { name: 'Zoë' }, cookie: asZoe })).status, 200)
    assert.equal((await call('PATCH', '/profiles/1', { body: { name: 'X' }, cookie: asZoe })).status, 403)
    assert.equal((await call('DELETE', '/profiles/1/photo', { cookie: asZoe })).status, 403)
    assert.equal((await call('POST', '/profiles', { body: { name: 'Sam', color: 'tech' }, cookie: asZoe })).status, 403)
    assert.equal((await call('DELETE', `/profiles/${zoe.id}`, { cookie: asZoe })).status, 403)
    assert.equal((await call('GET', '/storage', { cookie: asZoe })).status, 403)
    assert.equal((await call('DELETE', '/storage/texts', { cookie: asZoe })).status, 403)
    assert.equal((await call('DELETE', '/storage/texts')).status, 200)
    const usage = (await (await call('GET', '/ai-usage', { cookie: asZoe })).json()) as { profiles: unknown[] }
    assert.deepEqual(usage.profiles, [])
    assert.equal((await call('POST', '/ai-usage/reset', { body: {}, cookie: asZoe })).status, 403)
    assert.equal((await call('POST', '/ai-usage/reset', { body: { kind: 'nope' } })).status, 400)
    assert.equal((await call('POST', '/ai-usage/reset', { body: { kind: 'summary', profileId: zoe.id } })).status, 200)

    // Zoé has an account of her own: deleting her profile takes the admin's password.
    assert.equal((await call('DELETE', `/profiles/${zoe.id}`)).status, 403)
    assert.equal((await call('DELETE', `/profiles/${zoe.id}`, { body: { password: PASSWORD } })).status, 204)
  })

  it('lets every adult manage the young profiles, and a young profile only its colour and avatar', async () => {
    const parent = (await (await call('POST', '/profiles', { body: { name: 'Sam', color: 'tech' } })).json()) as {
      id: number
    }
    const asParent = await openAdult(session, parent.id)
    // A parent adds young profiles, never an adult.
    assert.equal(
      (await call('POST', '/profiles', { body: { name: 'Eva', color: 'ai' }, cookie: asParent })).status,
      403
    )
    const max = (await (
      await call('POST', '/profiles', { body: { name: 'Max', color: 'sport', kind: 'child' }, cookie: asParent })
    ).json()) as { id: number; kind: string; avatar: string }
    assert.equal(max.kind, 'child')
    assert.ok(max.avatar)
    assert.equal(
      (await call('POST', '/profiles', { body: { name: 'X', color: 'ai', kind: 'boss' }, cookie: asParent })).status,
      400
    )

    // The parent renames the child and makes it a teen; not an adult, and not the admin's profile.
    assert.equal(
      (await call('PATCH', `/profiles/${max.id}`, { body: { name: 'Maxime', kind: 'teen' }, cookie: asParent })).status,
      200
    )
    assert.equal(
      (await call('PATCH', `/profiles/${max.id}`, { body: { kind: 'adult' }, cookie: asParent })).status,
      403
    )
    assert.equal((await call('PATCH', '/profiles/1', { body: { name: 'X' }, cookie: asParent })).status, 403)

    // The young profile picks its colour, not its name or kind.
    const asMax = `${session.split('; ')[0]}; hodi_profile=${max.id}`
    await call('PATCH', `/profiles/${max.id}`, { body: { kind: 'child' }, cookie: asParent })
    assert.equal(
      (await call('PATCH', `/profiles/${max.id}`, { body: { color: 'music', avatar: 'owl' }, cookie: asMax })).status,
      200
    )
    // A device from before the topics' ids were English sends the colour's old name: it is taken under the new one.
    const recolored = await call('PATCH', `/profiles/${max.id}`, { body: { color: 'musique' }, cookie: asMax })
    assert.equal(recolored.status, 200)
    assert.equal(((await recolored.json()) as { color: string }).color, 'music')
    assert.equal((await call('PATCH', `/profiles/${max.id}`, { body: { color: 'rouge' }, cookie: asMax })).status, 400)
    assert.equal((await call('PATCH', `/profiles/${max.id}`, { body: { name: 'Boss' }, cookie: asMax })).status, 403)
    assert.equal((await call('PATCH', `/profiles/${max.id}`, { body: { kind: 'adult' }, cookie: asMax })).status, 403)
    assert.equal(
      (await call('POST', '/profiles', { body: { name: 'Y', color: 'ai', kind: 'child' }, cookie: asMax })).status,
      403
    )
    const photo = await fetch(`${baseUrl}/api/profiles/${max.id}/photo`, {
      method: 'PUT',
      headers: { cookie: asMax, 'Content-Type': 'image/webp' },
      body: Buffer.from('RIFF0000WEBPVP8 ', 'latin1')
    })
    assert.equal(photo.status, 409)

    // Deleting stays the admin's.
    assert.equal((await call('DELETE', `/profiles/${max.id}`, { cookie: asParent })).status, 403)
    assert.equal((await call('DELETE', `/profiles/${max.id}`)).status, 204)
    assert.equal((await call('DELETE', `/profiles/${parent.id}`, { body: { password: PASSWORD } })).status, 204)
  })

  it('renames, refuses bad names and colours, and never deletes the admin', async () => {
    assert.equal((await call('POST', '/profiles', { body: { name: '', color: 'science' } })).status, 400)
    assert.equal((await call('POST', '/profiles', { body: { name: 'Sam', color: 'rose' } })).status, 400)
    assert.equal((await call('PATCH', '/profiles/1', { body: { name: 'Alexandre' } })).status, 200)
    assert.equal((await call('PATCH', '/profiles/999', { body: { name: 'X' } })).status, 404)

    const { profiles } = (await (await call('GET', '/profiles')).json()) as {
      profiles: { id: number; role: string }[]
    }
    assert.deepEqual(
      profiles.filter(profile => profile.role === 'admin').map(profile => profile.id),
      [1]
    )
    for (const profile of profiles.filter(other => other.id !== 1)) {
      assert.equal((await call('DELETE', `/profiles/${profile.id}`, { body: { password: PASSWORD } })).status, 204)
    }
    assert.equal((await call('DELETE', '/profiles/1')).status, 409)
  })

  it('needs a session', async () => {
    assert.equal((await call('GET', '/profiles', { cookie: '' })).status, 401)
  })
})

describe('adding a source', () => {
  let session = ''
  const call = (method: string, route: string, { body, cookie = session }: { body?: unknown; cookie?: string } = {}) =>
    fetch(`${baseUrl}/api${route}`, {
      method,
      headers: { cookie, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    })

  before(async () => {
    clock += 2 * 60_000
    session = sessionCookieFrom(await login(PASSWORD))
  })

  it('finds a feed from a link, adds it to a topic, and lets only its profile remove it', async () => {
    const found = (await (await call('POST', '/sources/find', { body: { url: 'blog.example' } })).json()) as {
      status: string
      added: number
      limit: number | null
    }
    assert.equal(found.status, 'ok')
    // No limit until Serveur › Contenu sets one.
    assert.equal(found.limit, null)

    assert.equal(
      (
        await call('POST', '/sources', {
          body: { url: 'https://rien.example', section: 'topic', sectionId: 'belgium' }
        })
      ).status,
      422
    )
    assert.equal(
      (await call('POST', '/sources', { body: { url: 'video', section: 'topic', sectionId: 'belgium' } })).status,
      400
    )

    const added = await call('POST', '/sources', {
      body: { url: 'blog.example', section: 'topic', sectionId: 'belgium' }
    })
    assert.equal(added.status, 201)
    const { id } = (await added.json()) as { id: string }
    assert.equal(id, 'p1-le-blog')

    const topics = (await (await call('GET', '/topics')).json()) as { topics: { sources: { id: string }[] }[] }
    assert.ok(topics.topics[0]?.sources.some(source => source.id === id))
    const statuses = (await (await call('GET', '/sources')).json()) as { sources: { id: string; addedBy?: number }[] }
    assert.equal(statuses.sources.find(source => source.id === id)?.addedBy, 1)

    // Already followed: not twice.
    assert.equal(
      (await call('POST', '/sources', { body: { url: 'blog.example', section: 'topic', sectionId: 'belgium' } }))
        .status,
      409
    )

    const other = (await (await call('POST', '/profiles', { body: { name: 'Zoé', color: 'ai' } })).json()) as {
      id: number
    }
    const asOther = await openAdult(session, other.id)
    // A new profile starts with the base sources: the one added is off for it.
    const zoe = (await (await call('GET', '/me', { cookie: asOther })).json()) as {
      preferences: { hiddenSources?: string[] } | null
    }
    assert.deepEqual(zoe.preferences?.hiddenSources, [id])

    // In two topics, the first one labelling it; only its profile (or the admin) changes them.
    assert.equal((await call('PATCH', `/sources/${id}`, { body: { topicIds: ['world', 'belgium'] } })).status, 204)
    const moved = (await (await call('GET', '/topics')).json()) as {
      topics: { id: string; sources: { id: string }[] }[]
    }
    assert.deepEqual(
      moved.topics.map(topic => topic.sources.some(source => source.id === id)),
      [true, true]
    )
    assert.equal((await call('PATCH', `/sources/${id}`, { body: { topicIds: ['nope'] } })).status, 400)
    assert.equal(
      (
        await call('PATCH', `/sources/${id}`, {
          body: { topicIds: ['world'] },
          cookie: asOther
        })
      ).status,
      403
    )

    // sources.yml's proposals, added in one tap, then no longer proposed; hidden for the other profile.
    const proposals = (await (await call('GET', '/sources/proposals')).json()) as {
      proposals: { id: string; topicId: string }[]
    }
    assert.deepEqual(proposals.proposals, [
      { id: 'gazette', name: 'La Gazette', topicId: 'belgium', lang: 'fr', site: 'https://gazette.example/' }
    ])
    assert.equal((await call('POST', '/sources/proposals/gazette')).status, 201)
    assert.deepEqual(((await (await call('GET', '/sources/proposals')).json()) as { proposals: [] }).proposals, [])
    assert.equal((await call('POST', '/sources/proposals/gazette')).status, 404)
    const zoeAgain = (await (await call('GET', '/me', { cookie: asOther })).json()) as {
      preferences: { hiddenSources?: string[] } | null
    }
    assert.deepEqual(zoeAgain.preferences?.hiddenSources, [id, 'gazette'])
    assert.equal((await call('DELETE', '/sources/gazette')).status, 204)
    assert.equal((await call('DELETE', `/sources/${id}`, { cookie: asOther })).status, 403)
    // A starting-list source: hidden by whoever wants, removed by no one.
    assert.equal((await call('DELETE', '/sources/bx1', { cookie: asOther })).status, 403)
    assert.equal((await call('DELETE', '/sources/nope')).status, 404)

    assert.equal((await call('DELETE', `/sources/${id}`)).status, 204)

    // Suggested once it is no longer followed; BX1, followed, never is.
    const suggested = (await (
      await call('POST', '/sources/suggest', { body: { topicId: 'belgium', replacing: 'bx1' } })
    ).json()) as { status: string; suggestions: { link: string; source: { name: string } }[] }
    assert.equal(suggested.status, 'ok')
    assert.deepEqual(
      suggested.suggestions.map(suggestion => suggestion.link),
      ['https://blog.example/']
    )
    assert.equal((await call('POST', '/sources/suggest', { body: { topicId: 'nope' } })).status, 400)

    assert.equal((await call('DELETE', '/sources/bx1')).status, 403)
    const left = (await (await call('GET', '/sources')).json()) as { sources: { id: string; lang: string }[] }
    assert.equal(
      left.sources.some(source => source.id === 'bx1'),
      true
    )
    assert.ok(left.sources.every(source => source.lang === 'fr' || source.lang === 'en'))
    assert.equal((await call('DELETE', `/profiles/${other.id}`, { body: { password: PASSWORD } })).status, 204)
  })
})
