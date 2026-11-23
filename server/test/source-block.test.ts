import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { after, describe, it } from 'node:test'
import express from 'express'
import { BlockedDomainStore, feedKeyOf } from '../db/blocked-domain-store.ts'
import { openDatabase } from '../db/database.ts'
import { ProfileStore } from '../db/profile-store.ts'
import { SourceStore } from '../db/source-store.ts'
import { UserAccountStore, type UserAccount } from '../db/user-account-store.ts'
import { mountSourceBlockRoutes } from '../http/source-block-routes.ts'
import { sourceRoutes } from '../http/source-routes.ts'
import type { Catalog, Source } from '../news/catalog.ts'
import { NewsService } from '../news/news-service.ts'

const catalog = () =>
  ({
    topics: [{ id: 'belgium', label: { fr: 'Belgique', en: 'Belgium' }, sources: [] }],
    listen: []
  }) as unknown as Catalog

const source = (id: string, host: string, addedBy: number): Source & { addedBy: number } => ({
  id,
  name: host,
  url: `https://${host}/feed`,
  kind: 'article',
  lang: 'fr',
  domains: [host],
  reader: true,
  skip: [],
  addedBy
})

const article = (db: ReturnType<typeof openDatabase>, id: string, sourceId: string) =>
  db
    .prepare(
      `INSERT INTO articles (id, source_id, source_name, kind, lang, title, summary, link, first_seen_at, last_seen_at)
       VALUES (?, ?, 'S', 'article', 'fr', 'Un titre', '', 'https://example.com/a', 0, 0)`
    )
    .run(id, sourceId)

const count = (db: ReturnType<typeof openDatabase>, sql: string) => (db.prepare(sql).get() as { n: number }).n

// A server whose two sources of evil.example (one on a subdomain) and one of good.example were added by profiles 1,
// 2 and 3, with what was read of them; the admin is profile 1's account.
const start = () => {
  const db = openDatabase(':memory:')
  const store = new SourceStore(db)
  const domains = new BlockedDomainStore(db)
  const accounts = new UserAccountStore(db)
  const news = new NewsService(catalog(), { fetchText: async () => ({ text: '' }) as never, log: () => {} })
  // Profiles 2 and 3, beside the first one, the admin's.
  const profiles = new ProfileStore(db)
  profiles.create('Sam', 'tech', 0)
  profiles.create('Léa', 'tech', 0)
  const admin = accounts.createServerAdmin('admin@example.com', 'unused-hash', 0)!
  const sam = accounts.create('sam@example.com', 'unused-hash', 0)!
  const lea = accounts.create('lea@example.com', 'unused-hash', 0)!
  accounts.linkProfile(admin.id, 1)
  accounts.linkProfile(sam.id, 2)
  accounts.linkProfile(lea.id, 3)
  for (const [id, host, by] of [
    ['p2-evil', 'evil.example', 2],
    ['p1-news-evil', 'news.evil.example', 1],
    ['p3-good', 'good.example', 3]
  ] as const) {
    const added = source(id, host, by)
    store.add(added, 'topic', ['belgium'], 0)
    news.addSource(added, 'topic', ['belgium'])
    article(db, `${id}-1`, id)
    db.prepare("INSERT INTO my_sources (owner, source_id, added_at) VALUES ('a2', ?, 0)").run(id)
  }
  db.prepare("INSERT INTO saved_articles (owner, article_id, item, saved_at) VALUES ('a2', 'p2-evil-1', '{}', 0)").run()
  db.prepare(
    `INSERT INTO source_requests (profile_id, source, status, at) VALUES (3, '{"url":"https://evil.example/rss"}', 'pending', 0)`
  ).run()
  db.prepare(
    "INSERT INTO shares (profile_id, article_id, from_profile, item, shared_at) VALUES (3, 'p1-news-evil-1', 2, '{}', 0)"
  ).run()

  const removed: [UserAccount, boolean][] = []
  const erased: string[][] = []
  const app = express()
  app.use(express.json())
  app.use((_request, response, next) => {
    // The admin's profile is open.
    response.locals.profileId = 1
    next()
  })
  const router = express.Router()
  mountSourceBlockRoutes(
    router,
    { domains, news, official: () => new Set(['official']), onErased: ids => erased.push(ids) },
    {
      accounts,
      // The proof is the request's own: « yes » passes.
      proven: async (request, response) => {
        if (request.body?.password === 'yes') return true
        response.status(403).json({ error: 'invalid_password' })
        return false
      },
      removeAccount: (account, blocks) => removed.push([account, blocks]),
      now: () => 7
    }
  )
  app.use('/server', router)
  const server = app.listen(0)
  after(() => server.close())
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const call = (path: string, method: string, body?: unknown) =>
    fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  return { db, news, domains, call, removed, erased, sam }
}

describe('« Bloquer » a source', () => {
  it('blocks its domain with the proof, erases every source on it, and blocks the account that added this one', async () => {
    const { db, news, call, removed, erased, sam } = start()
    assert.equal((await call('/server/sources/nope/block', 'POST', { password: 'yes' })).status, 404)
    assert.equal((await call('/server/sources/p2-evil/block', 'POST', {})).status, 403)

    // Said before the password: the domain, its two sources, and an account.
    const preview = await call('/server/sources/p2-evil/block', 'GET')
    assert.deepEqual(await preview.json(), { target: 'evil.example', sources: 2, account: true })
    const blocked = await call('/server/sources/p2-evil/block', 'POST', { password: 'yes' })
    assert.deepEqual([blocked.status, await blocked.json()], [200, { target: 'evil.example' }])
    // Its subdomain's source too; the other site stays.
    assert.deepEqual(erased, [['p2-evil', 'p1-news-evil']])
    assert.deepEqual(
      news.getSourceStatuses().map(status => status.id),
      ['p3-good']
    )
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM sources WHERE id LIKE '%evil'"), 0)
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM articles WHERE source_id LIKE '%evil'"), 0)
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM saved_articles'), 0)
    // Shared with someone before: gone from their Partages too.
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM shares'), 0)
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM source_requests'), 0)
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM my_sources WHERE source_id LIKE '%evil'"), 0)
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM household_sources WHERE source_id LIKE '%evil'"), 0)
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM articles WHERE source_id = 'p3-good'"), 1)
    // Sam added the one blocked, and is blocked; whoever added another feed of the site is not.
    assert.deepEqual(
      removed.map(([account, blocks]) => [account.id, blocks]),
      [[sam.id, true]]
    )
  })

  it('never blocks a source of sources.yml, and unblocks a domain with the proof', async () => {
    const { news, domains, call } = start()
    news.addSource(source('official', 'official.example', 1), 'topic', ['belgium'])
    const official = await call('/server/sources/official/block', 'POST', { password: 'yes' })
    assert.deepEqual([official.status, await official.json()], [403, { error: 'official' }])
    domains.block('official.example', 1)
    const listed = (await (await call('/server/blocks', 'GET')).json()) as { domains: { domain: string }[] }
    assert.deepEqual(
      listed.domains.map(entry => entry.domain),
      ['official.example']
    )
    assert.equal((await call('/server/blocks/official.example', 'DELETE', {})).status, 403)
    assert.equal((await call('/server/blocks/nope.example', 'DELETE', { password: 'yes' })).status, 404)
    assert.equal((await call('/server/blocks/WWW.Official.example', 'DELETE', { password: 'yes' })).status, 204)
    assert.deepEqual(domains.all(), [])
  })

  it('blocks a feed alone on a host many share, never the whole host', async () => {
    const { db, news, domains, call } = start()
    const channel = (id: string, channelId: string): Source & { addedBy: number } => ({
      ...source(id, 'www.youtube.com', 3),
      url: `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`,
      kind: 'video',
      domains: []
    })
    for (const added of [channel('p3-bad', 'BAD'), channel('p3-fine', 'FINE')]) {
      new SourceStore(db).add(added, 'listen', ['videos'], 0)
      news.addSource(added, 'topic', ['belgium'])
    }
    const preview = (await (await call('/server/sources/p3-bad/block', 'GET')).json()) as { target: string }
    assert.equal(preview.target, 'youtube.com/channel_id=BAD')
    await call('/server/sources/p3-bad/block', 'POST', { password: 'yes' })
    assert.equal(domains.covers(channel('x', 'BAD')), true)
    // The same channel typed another way.
    const again = { url: 'http://m.youtube.com/feeds/videos.xml?x=1&channel_id=BAD#top', domains: [] }
    assert.equal(domains.covers(again), true)
    assert.equal(feedKeyOf('https://www.substack.com/feed/?b=2&a=1'), feedKeyOf('http://substack.com/feed?a=1&b=2'))
    assert.equal(domains.covers(channel('x', 'FINE')), false)
    assert.equal(
      news.getSourceStatuses().some(status => status.id === 'p3-fine'),
      true
    )
  })

  it('refuses a feed of a blocked domain when it is looked for or added, at once', async () => {
    const db = openDatabase(':memory:')
    const domains = new BlockedDomainStore(db)
    const news = new NewsService(catalog(), { fetchText: async () => ({ text: '' }) as never, log: () => {} })
    const app = express()
    app.use(express.json())
    app.use((_request, response, next) => {
      response.locals.profileId = 1
      next()
    })
    app.use(
      '/sources',
      sourceRoutes({
        news,
        sources: new SourceStore(db),
        find: async link => {
          const host = new URL(link).hostname
          return {
            status: 'ok',
            source: { ...source('x', host, 1), origin: 'feed', readable: { tried: 1, ok: 1 }, samples: [] }
          }
        },
        proposals: () => [],
        maxSources: () => null,
        onAdded: () => {},
        blocked: found => domains.covers(found),
        now: () => 1
      })
    )
    const server = app.listen(0)
    after(() => server.close())
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const post = (path: string, body: unknown) =>
      fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
    // Looked for once, then its domain blocked: the answer kept for that link is refused all the same.
    assert.equal(
      ((await (await post('/sources/find', { url: 'https://www.evil.example' })).json()) as { status: string }).status,
      'ok'
    )
    domains.block('evil.example', 2)
    const found = (await (await post('/sources/find', { url: 'https://www.evil.example' })).json()) as {
      status: string
    }
    assert.equal(found.status, 'unavailable')
    const added = await post('/sources', { url: 'https://www.evil.example', section: 'topic', topicIds: ['belgium'] })
    assert.deepEqual([added.status, await added.json()], [422, { error: 'unavailable' }])
    assert.equal(domains.covers({ url: 'https://evil.example.org/feed', domains: [] }), false)
  })
})
