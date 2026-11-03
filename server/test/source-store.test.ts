import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { describe, it } from 'node:test'
import { openDatabase } from '../db/database.ts'
import { migrate } from '../db/migrations.ts'
import { SourceStore, createPauseCheck } from '../db/source-store.ts'
import { parseCatalog } from '../news/catalog.ts'

const NOW = Date.UTC(2026, 9, 25, 12)

const file = (extra = '') =>
  parseCatalog(`
topics:
  - id: monde
    label: Monde
    sources:
      - id: alpha
        name: Alpha
        url: https://alpha.example/feed
        domains: [alpha.example]
        skip: [/video/]
        base: [fr]
${extra}
  - id: tech
    label: Tech
    sources:
      - id: delta
        name: Delta
        url: https://delta.example/feed
        domains: [delta.example]
listen:
  - id: actu
    label: Actu
    sources:
      - id: chaine
        name: Chaîne
        url: https://www.youtube.com/feeds/videos.xml?channel_id=UC123
`)

const BETA = `      - id: beta
        name: Beta
        url: https://beta.example/feed
        reader: false`

const count = (db: ReturnType<typeof openDatabase>) =>
  (db.prepare('SELECT COUNT(*) AS n FROM sources').get() as { n: number }).n

const addedBy = (db: ReturnType<typeof openDatabase>) =>
  Object.fromEntries(
    (db.prepare('SELECT id, added_by FROM sources').all() as { id: string; added_by: number | null }[]).map(row => [
      row.id,
      row.added_by
    ])
  )

describe('source store', () => {
  it('starts a new household with the base sources only, the others proposed', () => {
    const store = new SourceStore(openDatabase(':memory:'))
    const catalog = store.load(file(BETA), NOW, 'fr')

    assert.deepEqual(
      catalog.topics.map(topic => [topic.id, topic.sources.map(source => source.id)]),
      [
        ['monde', ['alpha']],
        ['tech', []]
      ]
    )
    // Without the file's "base" flag, as every source of the database.
    const alpha = { ...file().topics[0]!.sources[0]! }
    delete alpha.base
    assert.deepEqual(catalog.topics[0]?.sources[0], alpha)
    // No channel is a base one: each starts as nobody's.
    assert.deepEqual(
      catalog.listen.map(listen => listen.sources),
      [[]]
    )
    assert.deepEqual(
      store.proposals(file(BETA)).map(({ source, topicId }) => [source.id, topicId]),
      [
        ['beta', 'monde'],
        ['delta', 'tech']
      ]
    )
  })

  it('waits for the household’s language, then starts with that language’s base sources', () => {
    const db = openDatabase(':memory:')
    const store = new SourceStore(db)
    const both = file(`      - id: gamma
        name: Gamma
        url: https://gamma.example/feed
        domains: [gamma.example]
        lang: en
        base: [en]`)

    assert.deepEqual(
      store.load(both, NOW, null).topics.map(topic => topic.sources.length),
      [0, 0]
    )
    assert.equal(count(db), 0)

    assert.deepEqual(
      store.load(both, NOW + 1, 'en').topics.map(topic => topic.sources.map(source => source.id)),
      [['gamma'], []]
    )
    // French base sources stay proposed.
    assert.deepEqual(
      store.proposals(both).map(({ source }) => source.id),
      ['alpha', 'delta']
    )
    // Once filled, the household's later language changes keep its sources.
    assert.deepEqual(
      store.load(both, NOW + 2, 'fr').topics.map(topic => topic.sources.map(source => source.id)),
      [['gamma'], []]
    )
  })

  it('takes the file once: later starts keep the database’s sources, removed ones stay gone', () => {
    const db = openDatabase(':memory:')
    const store = new SourceStore(db)
    store.load(file(), NOW, 'fr')
    assert.equal(store.remove('alpha'), true)

    const catalog = store.load(file(BETA), NOW + 1, 'fr')

    assert.deepEqual(
      catalog.topics.map(topic => topic.sources.length),
      [0, 0]
    )
    assert.equal(count(db), 0)
  })

  it('gives an older household’s fetched sources to its admin, the others still proposed', () => {
    const db = openDatabase(':memory:')
    db.prepare(
      `INSERT INTO articles (id, source_id, source_name, kind, lang, title, summary, link, first_seen_at, last_seen_at)
       VALUES ('a', 'beta', 'Beta', 'article', 'fr', 'T', '', 'https://beta.example/a', 0, 0)`
    ).run()
    const catalog = new SourceStore(db).load(file(BETA), NOW, 'fr')

    assert.deepEqual(
      catalog.topics.map(topic => topic.sources.map(source => source.id)),
      [['alpha', 'beta'], []]
    )
    assert.deepEqual(addedBy(db), { alpha: null, beta: 1 })
  })

  it('moves a catalogue filled before base sources to the admin, once', () => {
    const db = openDatabase(':memory:')
    const store = new SourceStore(db)
    store.load(file(), NOW, 'fr')
    // As the catalogue was before: every source of the file, nobody's.
    db.prepare("DELETE FROM seeds WHERE name = 'base-sources'").run()
    store.add({ ...file().topics[1]!.sources[0]!, addedBy: 1 }, 'topic', ['tech'], NOW)
    db.prepare("UPDATE sources SET added_by = NULL WHERE id = 'delta'").run()

    store.load(file(), NOW + 1, 'fr')
    assert.deepEqual(addedBy(db), { alpha: null, delta: 1 })
    // Done once: a source made nobody's later stays so.
    db.prepare("UPDATE sources SET added_by = NULL WHERE id = 'delta'").run()
    store.load(file(), NOW + 2, 'fr')
    assert.equal(addedBy(db).delta, null)
  })

  it('gives the channels of a catalogue filled when they were base ones to the admin, once', () => {
    const db = openDatabase(':memory:')
    const store = new SourceStore(db)
    store.load(file(), NOW, 'fr')
    // As the catalogue was before: every channel of the file, nobody's.
    db.prepare("DELETE FROM seeds WHERE name = 'own-channels'").run()
    store.add({ ...file().listen[0]!.sources[0]!, addedBy: 1 }, 'listen', ['actu'], NOW)
    db.prepare("UPDATE sources SET added_by = NULL WHERE id = 'chaine'").run()

    store.load(file(), NOW + 1, 'fr')
    assert.deepEqual(addedBy(db), { alpha: null, chaine: 1 })
  })

  it('lists a source in each of its topics, the first one first', () => {
    const store = new SourceStore(openDatabase(':memory:'))
    store.load(file(), NOW, 'fr')
    store.add({ ...file().topics[1]!.sources[0]!, addedBy: 1 }, 'topic', ['tech', 'monde'], NOW)
    assert.deepEqual(
      store.catalog(file()).topics.map(topic => topic.sources.map(source => source.id)),
      [['alpha', 'delta'], ['delta']]
    )

    assert.equal(store.setTopics('delta', ['monde']), true)
    assert.deepEqual(
      store.catalog(file()).topics.map(topic => topic.sources.map(source => source.id)),
      [['alpha', 'delta'], []]
    )
    assert.equal(store.setTopics('chaine', ['monde']), false)
  })
})

describe('pause check', () => {
  it('pauses a source only when every profile turned it off, asking again after a minute', () => {
    let clock = NOW
    let hidden = [['alpha', 'beta'], ['alpha']]
    const isPaused = createPauseCheck({ hiddenByProfile: () => hidden, now: () => clock })

    assert.equal(isPaused('alpha'), true)
    assert.equal(isPaused('beta'), false)

    hidden = [['alpha', 'beta'], []]
    assert.equal(isPaused('alpha'), true)
    clock += 61 * 1000
    assert.equal(isPaused('alpha'), false)
  })

  it('pauses nothing without profiles', () => {
    assert.equal(createPauseCheck({ hiddenByProfile: () => [], now: () => NOW })('alpha'), false)
  })

  it('drops the subreddits profiles added, now that Reddit closed its feeds', () => {
    const db = new DatabaseSync(':memory:')
    // The schema before Reddit's removal (migration 26).
    migrate(db, 25)
    const insert = db.prepare(
      `INSERT INTO sources (id, section, section_id, position, name, url, kind, lang, domains, reader, skip, created_at)
       VALUES (?, 'topic', 'monde', 0, ?, ?, 'article', 'en', '[]', 0, '[]', ?)`
    )
    insert.run('r-worldnews', 'r/worldnews', 'https://www.reddit.com/r/worldnews/top/.rss?t=day&limit=10', NOW)
    insert.run('alpha', 'Alpha', 'https://alpha.example/feed', NOW)

    migrate(db)

    const ids = db.prepare('SELECT id FROM sources').all() as { id: string }[]
    assert.deepEqual(
      ids.map(row => row.id),
      ['alpha']
    )
  })
})
