import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { describe, it } from 'node:test'
import { openDatabase } from '../db/database.ts'
import { SCHEMA_VERSION, migrate, versionBefore } from '../db/migrations.ts'
import { CONTENT_RETENTION_MS, NewsStore } from '../db/news-store.ts'
import { parseCatalog } from '../news/catalog.ts'
import { MAX_SUMMARIES_PER_DAY, NewsService } from '../news/news-service.ts'
import { itemId } from '../news/text.ts'
import { type FakeResponse, articlePage, fakeFetch, rssFeed } from './helpers/news.ts'

const NOW = Date.UTC(2026, 9, 23, 12)
const HOUR = 60 * 60 * 1000

const catalog = parseCatalog(`
topics:
  - id: monde
    label: Monde
    sources:
      - id: alpha
        name: Alpha
        url: https://alpha.example/feed
        domains: [alpha.example]
`)

const feed = rssFeed([
  { title: 'Sommet européen', link: 'https://alpha.example/sommet', date: 'Fri, 23 Oct 2026 10:00:00 +0000' }
])
const sommet = itemId('https://alpha.example/sommet')

// A service on the given database, as after a restart: the memory caches start empty.
const start = (
  store: NewsStore,
  responses: Record<string, FakeResponse>,
  { now = NOW, ...extra }: { summarize?: () => Promise<string[]>; now?: number } = {}
) => {
  const fake = fakeFetch(responses)
  const news = new NewsService(catalog, { fetchText: fake.fetchText, store, now: () => now, log: () => {}, ...extra })
  return { news, calls: fake.calls }
}

const listAll = async (news: NewsService) => {
  await news.getTopic('monde')
  await news.whenChecksIdle()
  return (await news.getTopic('monde'))?.items.map(item => item.title)
}

describe('NewsStore', () => {
  it('creates the schema once and leaves it alone afterwards', () => {
    const db = openDatabase(':memory:')
    migrate(db)
    const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
    assert.equal(version, SCHEMA_VERSION)
  })

  it('keeps listing an article and its reader text after a restart, once the feed dropped it', async () => {
    const store = new NewsStore(openDatabase(':memory:'))
    const first = start(store, {
      'https://alpha.example/feed': feed,
      'https://alpha.example/sommet': articlePage('Sommet européen')
    })
    assert.deepEqual(await listAll(first.news), ['Sommet européen'])

    // After the restart the feed is empty and the site is down: the store still has everything.
    const second = start(store, { 'https://alpha.example/feed': rssFeed([]) })
    assert.deepEqual(await listAll(second.news), ['Sommet européen'])

    const article = await second.news.getArticle(sommet)
    assert.equal(article.status, 'ok')
    assert.ok(!second.calls.includes('https://alpha.example/sommet'))
  })

  it('shows a paid summary again for free after a restart, and keeps counting the daily cap', async () => {
    const store = new NewsStore(openDatabase(':memory:'))
    const responses = {
      'https://alpha.example/feed': feed,
      'https://alpha.example/sommet': articlePage('Sommet européen')
    }
    let calls = 0
    const summarize = async () => {
      calls++
      return ['Un point']
    }

    const first = start(store, responses, { summarize })
    await listAll(first.news)
    assert.deepEqual(await first.news.getSummary(sommet), { status: 'ok', points: ['Un point'] })

    const second = start(store, responses, { summarize })
    await listAll(second.news)
    assert.deepEqual(await second.news.getSummary(sommet), { status: 'ok', points: ['Un point'] })
    assert.equal(calls, 1)
    assert.deepEqual(store.aiCalls(NOW - 24 * HOUR), [{ kind: 'summary', at: NOW, profileId: 1 }])
    assert.ok(MAX_SUMMARIES_PER_DAY > 1)

    // Put back to 0, for the profile then for everyone: kept across a restart, never lowered.
    second.news.resetAiUsage({ kind: 'summary', profileId: 1 })
    assert.deepEqual(store.aiCalls(NOW - 24 * HOUR), [{ kind: 'summary', at: NOW, profileId: 1, cleared: 'profile' }])
    second.news.resetAiUsage({})
    second.news.resetAiUsage({ profileId: 1 })
    assert.deepEqual(store.aiCalls(NOW - 24 * HOUR), [{ kind: 'summary', at: NOW, profileId: 1, cleared: 'all' }])
  })

  it('shows the reading time and author on the card once the article is read, even after a restart', async () => {
    const store = new NewsStore(openDatabase(':memory:'))
    const responses = {
      'https://alpha.example/feed': feed,
      'https://alpha.example/sommet': articlePage('Sommet européen', { author: 'Par Marie Dupont' })
    }
    await listAll(start(store, responses).news)

    const { news } = start(store, { 'https://alpha.example/feed': feed })
    const [item] = (await news.getTopic('monde'))?.items ?? []
    assert.equal(item?.readingMinutes, 1)
    assert.equal(item?.author, 'Marie Dupont')
  })

  it('finds older articles in the store, gone from the feeds and the topics', async () => {
    const store = new NewsStore(openDatabase(':memory:'))
    await listAll(
      start(store, {
        'https://alpha.example/feed': feed,
        'https://alpha.example/sommet': articlePage('Sommet européen')
      }).news
    )

    // Ten days later: the topic no longer lists it, the search still finds it, accents aside.
    const { news } = start(store, { 'https://alpha.example/feed': rssFeed([]) }, { now: NOW + 10 * 24 * HOUR })
    assert.deepEqual((await news.getTopic('monde'))?.items, [])
    const found = await news.search('europeen')
    assert.deepEqual(
      found.items.map(item => [item.title, item.topicId]),
      [['Sommet européen', 'monde']]
    )
    assert.deepEqual((await news.search('sommets')).items, [])
    // The source's name counts as a word too: "alpha sommet" finds it, "alpha élections" does not.
    assert.deepEqual(
      (await news.search('alpha sommet')).items.map(item => item.title),
      ['Sommet européen']
    )
    assert.deepEqual((await news.search('alpha elections')).items, [])
  })

  it('lists "Le fil" one day at a time, skipping days without articles', async () => {
    const store = new NewsStore(openDatabase(':memory:'))
    const twoDays = rssFeed([
      { title: 'Sommet européen', link: 'https://alpha.example/sommet', date: 'Fri, 23 Oct 2026 10:00:00 +0000' },
      { title: 'Budget fédéral voté', link: 'https://alpha.example/veille', date: 'Thu, 22 Oct 2026 22:30:00 +0000' }
    ])
    await listAll(
      start(store, {
        'https://alpha.example/feed': twoDays,
        'https://alpha.example/sommet': articlePage('Sommet européen'),
        'https://alpha.example/veille': articlePage('Budget fédéral voté')
      }).news
    )

    // Two days later, nothing new: today is empty, so the 23rd comes first.
    const { news } = start(store, { 'https://alpha.example/feed': rssFeed([]) }, { now: NOW + 2 * 24 * HOUR })
    const latest = await news.getDay(null, 'Europe/Brussels')
    assert.equal(latest?.day, '2026-10-23')
    // 22:30 UTC on the 22nd is already the 23rd in Brussels.
    assert.deepEqual(
      latest?.items.map(item => item.title),
      ['Sommet européen', 'Budget fédéral voté']
    )
    assert.equal(latest?.previousDay, null)

    const utc = await news.getDay('2026-10-23', 'UTC')
    assert.deepEqual(
      utc?.items.map(item => item.title),
      ['Sommet européen']
    )
    assert.equal(utc?.previousDay, '2026-10-22')
    assert.equal(await news.getDay('2026-10-30', 'UTC'), null)
  })

  it('drops old reader text but keeps the article row', async () => {
    const store = new NewsStore(openDatabase(':memory:'))
    const { news } = start(store, {
      'https://alpha.example/feed': feed,
      'https://alpha.example/sommet': articlePage('Sommet européen')
    })
    await listAll(news)
    assert.ok(store.getContent(sommet))

    store.prune(NOW + CONTENT_RETENTION_MS + HOUR)

    assert.equal(store.getContent(sommet), null)
    assert.equal(store.findItem(sommet)?.item.title, 'Sommet européen')
  })

  it('empties every reader text on demand, keeping the articles', async () => {
    const store = new NewsStore(openDatabase(':memory:'))
    const { news } = start(store, {
      'https://alpha.example/feed': feed,
      'https://alpha.example/sommet': articlePage('Sommet européen')
    })
    await listAll(news)
    assert.ok(store.counts().texts > 0)

    store.clearTexts()

    assert.equal(store.counts().texts, 0)
    assert.equal(store.getContent(sommet), null)
    assert.ok(store.counts().articles > 0)
  })
})

describe('backupDatabase', () => {
  it('writes one backup a day and keeps the last seven', async () => {
    const { mkdtempSync, readdirSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const path = await import('node:path')
    const { backupDatabase } = await import('../db/maintenance.ts')
    const dir = mkdtempSync(path.join(tmpdir(), 'hodi-backups-'))
    const db = openDatabase(':memory:')

    for (let day = 0; day < 9; day++) await backupDatabase(db, dir, NOW + day * 24 * HOUR)
    await backupDatabase(db, dir, NOW + 8 * 24 * HOUR)

    const names = readdirSync(dir).sort()
    assert.equal(names.length, 7)
    assert.equal(names.at(-1), 'hodi-2026-10-31.db')
  })

  it('sums the backups for the settings', async () => {
    const { mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const path = await import('node:path')
    const { backupDatabase, diskUsage } = await import('../db/maintenance.ts')
    const dir = mkdtempSync(path.join(tmpdir(), 'hodi-usage-'))
    const db = openDatabase(':memory:')

    assert.deepEqual(diskUsage(path.join(dir, 'missing.db'), path.join(dir, 'none')), {
      databaseBytes: 0,
      backupBytes: 0,
      backups: 0
    })
    await backupDatabase(db, dir, NOW)
    const usage = diskUsage(path.join(dir, 'missing.db'), dir)
    assert.equal(usage.backups, 1)
    assert.ok(usage.backupBytes > 0)
  })

  it('keeps the daily summaries and their AI calls from when they were named "brief"', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db, versionBefore('ALTER TABLE daily_briefs RENAME'))
    db.prepare(
      "INSERT INTO daily_briefs (points, generated_at, created_at, profile_id, language) VALUES ('[]', '2026-10-23', ?, 1, 'fr')"
    ).run(NOW)
    db.prepare("INSERT INTO ai_calls (kind, at, profile_id) VALUES ('brief', ?, 1)").run(NOW)

    migrate(db)

    assert.equal(new NewsStore(db).latestDailySummaries().get(1)?.generatedAt, '2026-10-23')
    assert.deepEqual(
      db
        .prepare('SELECT kind FROM ai_calls')
        .all()
        .map(row => row.kind),
      ['dailySummary']
    )
  })

  it('keeps the summaries and daily summaries written before languages, as French ones', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    // The schema before summaries had a language.
    migrate(db, versionBefore('CREATE TABLE ai_summaries_by_language'))
    db.prepare(
      `INSERT INTO articles (id, source_id, source_name, kind, lang, title, summary, link, first_seen_at, last_seen_at)
       VALUES (?, 'alpha', 'Alpha', 'article', 'fr', 'Sommet', '', 'https://alpha.example/sommet', ?, ?)`
    ).run(sommet, NOW, NOW)
    db.prepare('INSERT INTO ai_summaries (article_id, points, created_at) VALUES (?, ?, ?)').run(
      sommet,
      '["Un point"]',
      NOW
    )
    db.prepare(
      "INSERT INTO daily_briefs (points, generated_at, created_at, profile_id) VALUES ('[]', '2026-10-23', ?, 1)"
    ).run(NOW)

    migrate(db)
    const store = new NewsStore(db)

    assert.deepEqual(store.getSummary(sommet, 'fr'), ['Un point'])
    assert.equal(store.getSummary(sommet, 'en'), null)
    store.saveSummary(sommet, 'en', ['A point'], NOW)
    assert.deepEqual(store.getSummary(sommet, 'en'), ['A point'])
    assert.deepEqual(store.getSummary(sommet, 'fr'), ['Un point'])
    assert.equal(store.latestDailySummaries().get(1)?.language, 'fr')
  })
})
