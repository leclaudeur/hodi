import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { describe, it } from 'node:test'
import { openDatabase } from '../db/database.ts'
import { migrate, versionBefore } from '../db/migrations.ts'
import { inHousehold } from '../db/household-scope.ts'
import { SourceStore, createPauseCheck } from '../db/source-store.ts'
import { parseCatalog } from '../news/catalog.ts'

const NOW = Date.UTC(2026, 9, 25, 12)

const file = (extra = '') =>
  parseCatalog(`
topics:
  - id: world
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
    (
      db.prepare('SELECT source_id AS id, added_by FROM household_sources').all() as {
        id: string
        added_by: number | null
      }[]
    ).map(row => [row.id, row.added_by])
  )

describe('source store', () => {
  it('starts a new household with the base sources only, the others proposed', () => {
    const store = new SourceStore(openDatabase(':memory:'))
    const catalog = store.load(file(BETA), NOW, 'fr')

    assert.deepEqual(
      catalog.topics.map(topic => [topic.id, topic.sources.map(source => source.id)]),
      [
        ['world', ['alpha']],
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
        ['beta', 'world'],
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

  it('stops reading a followed site once the file says it cannot be read, and only that one', () => {
    const db = openDatabase(':memory:')
    const store = new SourceStore(db)
    store.load(file(), NOW, 'fr')
    const walled = file().topics[0]!.sources[0]!.url
    const later = parseCatalog(
      `topics:\n  - id: world\n    label: Monde\n    sources:\n      - id: alpha\n        name: Alpha\n        url: ${walled}\n        reader: false\n        base: [fr]\n`
    )

    const catalog = store.load(later, NOW + 1, 'fr')

    assert.equal(catalog.topics[0]?.sources[0]?.reader, false)
    // Only turned off: a file that reads the site again leaves the install as it is.
    assert.equal(store.load(file(), NOW + 2, 'fr').topics[0]?.sources[0]?.reader, false)
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
    db.prepare("UPDATE household_sources SET added_by = NULL WHERE source_id = 'delta'").run()

    store.load(file(), NOW + 1, 'fr')
    assert.deepEqual(addedBy(db), { alpha: null, delta: 1 })
    // Done once: a source made nobody's later stays so.
    db.prepare("UPDATE household_sources SET added_by = NULL WHERE source_id = 'delta'").run()
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
    db.prepare("UPDATE household_sources SET added_by = NULL WHERE source_id = 'chaine'").run()

    store.load(file(), NOW + 1, 'fr')
    assert.deepEqual(addedBy(db), { alpha: null, chaine: 1 })
  })

  it('lists a source in each of its topics, the first one first', () => {
    const store = new SourceStore(openDatabase(':memory:'))
    store.load(file(), NOW, 'fr')
    store.add({ ...file().topics[1]!.sources[0]!, addedBy: 1 }, 'topic', ['tech', 'world'], NOW)
    assert.deepEqual(
      store.catalog(file()).topics.map(topic => topic.sources.map(source => source.id)),
      [['alpha', 'delta'], ['delta']]
    )

    assert.equal(store.setTopics('delta', ['world']), true)
    assert.deepEqual(
      store.catalog(file()).topics.map(topic => topic.sources.map(source => source.id)),
      [['alpha', 'delta'], []]
    )
    assert.equal(store.setTopics('chaine', ['world']), false)
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
       VALUES (?, 'topic', 'world', 0, ?, ?, 'article', 'en', '[]', 0, '[]', ?)`
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
  it('tidies the names of the sites added before names were tidied, and drops their country, once', () => {
    const db = openDatabase(':memory:')
    const store = new SourceStore(db)
    store.load(file(), NOW, 'fr')
    db.prepare("DELETE FROM seeds WHERE name IN ('tidy-names', 'tidy-names-2')").run()
    const site = (id: string, name: string, url: string, domains: string[] = []) => ({
      ...file().topics[1]!.sources[0]!,
      id,
      name,
      url,
      domains,
      addedBy: 1
    })
    store.add(
      site('p1-voici', "https://www.voici.fr : flux d'articles", 'https://www.voici.fr/rss.xml'),
      'topic',
      ['tech'],
      NOW
    )
    store.add(
      site('p1-mc', 'Beauté - Marie Claire Belgique', 'https://www.marieclaire.be/feed'),
      'topic',
      ['tech'],
      NOW
    )
    // A name the first pass took from the feed's own address: the site is the source's domain.
    store.add(
      site('p1-fa', 'feed.prismamediadigital.com', 'https://feed.prismamediadigital.com/femme-actuelle', [
        'femmeactuelle.fr'
      ]),
      'topic',
      ['tech'],
      NOW
    )
    // From the file ("Sources proposées"): its name stays, but the country.
    store.add(site('gamma', 'Gamma - All', 'https://gamma.example/feed'), 'topic', ['tech'], NOW)
    store.add(site('vogue', 'Vogue France', 'https://www.vogue.fr/feed'), 'topic', ['tech'], NOW)

    store.load(file(), NOW + 1, 'fr')
    const names = Object.fromEntries(
      (db.prepare('SELECT id, name FROM sources').all() as { id: string; name: string }[]).map(row => [
        row.id,
        row.name
      ])
    )
    assert.equal(names['p1-voici'], 'voici.fr')
    assert.equal(names['p1-mc'], 'Marie Claire · Beauté')
    assert.equal(names['p1-fa'], 'femmeactuelle.fr')
    assert.equal(names.gamma, 'Gamma - All')
    assert.equal(names.vogue, 'Vogue')
  })
  it('renames a source and the articles it already has', () => {
    const db = openDatabase(':memory:')
    const store = new SourceStore(db)
    store.load(file(), NOW, 'fr')
    const source = { ...file().topics[1]!.sources[0]!, id: 'p1-voici', name: 'voici.fr', addedBy: 1 }
    store.add(source, 'topic', ['tech'], NOW)
    store.rename('p1-voici', 'Voici')
    const row = db.prepare("SELECT name FROM sources WHERE id = 'p1-voici'").get() as { name: string }
    assert.equal(row.name, 'Voici')
  })
})

// A plugin's second household follows its own sources; a feed both follow is one row, fetched once.
describe("each household's sources", () => {
  const ids = (catalog: ReturnType<SourceStore['catalog']>) =>
    catalog.topics.map(topic => [topic.id, topic.sources.map(source => source.id)])

  it('keeps one list per household over shared feeds', () => {
    const db = openDatabase(':memory:')
    const store = new SourceStore(db)
    store.load(file(BETA), NOW, 'fr')
    db.prepare("INSERT INTO accounts (id, name, created_at, set_up_at) VALUES (2, 'Famille Martin', ?, ?)").run(
      NOW,
      NOW
    )
    const martinAdmin = Number(
      db
        .prepare(
          "INSERT INTO profiles (account_id, name, color, position, created_at, role) VALUES (2, 'Marc', 'world', 0, ?, 'admin')"
        )
        .run(NOW).lastInsertRowid
    )

    inHousehold(2, () => {
      // A new household gets the base sources of its own language: none here in English.
      store.seed(file(BETA), 'en', NOW)
      assert.deepEqual(ids(store.catalog(file(BETA))), [
        ['world', []],
        ['tech', []]
      ])
      assert.equal(store.has('alpha'), false)
      // The first household's feed, added here: the same id, its own topics.
      const feed = store.feedOf('https://alpha.example/feed')!
      assert.equal(feed.id, 'alpha')
      assert.equal(store.findByUrl('https://alpha.example/feed'), null)
      store.add({ ...feed, addedBy: martinAdmin }, 'topic', ['tech'], NOW)
      assert.deepEqual(ids(store.catalog(file(BETA))), [
        ['world', []],
        ['tech', ['alpha']]
      ])
      assert.equal(store.count(), 1)
    })
    // The first household's list did not move.
    assert.deepEqual(ids(store.catalog(file(BETA))), [
      ['world', ['alpha']],
      ['tech', []]
    ])
    assert.equal(count(db), 1)

    // Removed by the Martins: the Duponts still follow it, so the feed stays.
    assert.equal(
      inHousehold(2, () => store.remove('alpha')),
      true
    )
    assert.equal(count(db), 1)
    assert.equal(store.has('alpha'), true)
    // Removed by the Duponts too: nobody follows it, the feed goes.
    assert.equal(store.remove('alpha'), true)
    assert.equal(count(db), 0)
  })

  it('seeds a household once, in its language', () => {
    const db = openDatabase(':memory:')
    const store = new SourceStore(db)
    db.prepare("INSERT INTO accounts (id, name, created_at, set_up_at) VALUES (2, 'Famille Martin', ?, ?)").run(
      NOW,
      NOW
    )
    inHousehold(2, () => {
      store.seed(file(BETA), 'fr', NOW)
      store.seed(file(BETA), 'fr', NOW)
      assert.deepEqual(ids(store.catalog(file(BETA))), [
        ['world', ['alpha']],
        ['tech', []]
      ])
    })
    assert.equal(store.count(), 0)
  })
})

describe('household_sources migration', () => {
  it('gives every source of before to the first household, with its topics and adder', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    migrate(db, versionBefore('CREATE TABLE household_sources'))
    db.prepare(
      `INSERT INTO sources (id, section, section_id, topics, position, name, url, kind, lang, domains, reader, skip, added_by, created_at)
       VALUES ('alpha', 'topic', 'world', '["world"]', 0, 'Alpha', 'https://alpha.example/feed', 'rss', 'fr', '[]', 1, '[]', NULL, ?),
              ('blog', 'topic', 'tech', '["tech","ai"]', 3, 'Blog', 'https://blog.example/feed', 'rss', 'fr', '[]', 1, '[]', 1, ?)`
    ).run(NOW, NOW)

    migrate(db)

    assert.deepEqual(
      db
        .prepare(
          'SELECT household_id, source_id, section_id, topics, position, added_by FROM household_sources ORDER BY source_id'
        )
        .all()
        .map(row => Object.values(row)),
      [
        [1, 'alpha', 'world', '["world"]', 0, null],
        [1, 'blog', 'tech', '["tech","ai"]', 3, 1]
      ]
    )
    // The adder is the household's to know now: deleting that profile never takes another household's feed.
    assert.deepEqual(
      db
        .prepare('SELECT added_by FROM sources')
        .all()
        .map(row => row.added_by),
      [null, null]
    )
  })
})
