import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { describe, it } from 'node:test'
import { openDatabase } from '../db/database.ts'
import { migrate, versionBefore } from '../db/migrations.ts'
import { inHousehold } from '../db/household-scope.ts'
import { NewsStore } from '../db/news-store.ts'
import { SourceStore, createPauseCheck } from '../db/source-store.ts'
import { parseCatalog } from '../news/catalog.ts'
import { createIcons } from '../start/news.ts'
import { PNG, fakeFetch } from './helpers/news.ts'

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
      db.prepare('SELECT source_id AS id, added_by FROM catalog_sources').all() as {
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
    db.prepare("UPDATE catalog_sources SET added_by = NULL WHERE source_id = 'delta'").run()

    store.load(file(), NOW + 1, 'fr')
    assert.deepEqual(addedBy(db), { alpha: null, delta: 1 })
    // Done once: a source made nobody's later stays so.
    db.prepare("UPDATE catalog_sources SET added_by = NULL WHERE source_id = 'delta'").run()
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
    db.prepare("UPDATE catalog_sources SET added_by = NULL WHERE source_id = 'chaine'").run()

    store.load(file(), NOW + 1, 'fr')
    assert.deepEqual(addedBy(db), { alpha: null, chaine: 1 })
  })

  it('serves the icon of a source added since the start, and nothing for one outside the catalogue', async () => {
    const db = openDatabase(':memory:')
    const store = new SourceStore(db)
    store.load(file(), NOW, 'fr')
    const outside = fakeFetch({
      'https://delta.example/': '<html></html>',
      'https://delta.example/favicon.ico': PNG
    })
    const icons = createIcons({ file: file(BETA), outside, store: new NewsStore(db), sources: store })

    store.add({ ...file().topics[1]!.sources[0]!, addedBy: 1 }, 'topic', ['tech'], NOW)
    assert.equal((await icons.get('delta'))?.contentType, 'image/png')

    // Unknown until it is in the catalogue.
    assert.equal(await icons.get('beta'), undefined)
    store.add({ ...file(BETA).topics[0]!.sources[1]!, addedBy: 1 }, 'topic', ['world'], NOW)
    // Beta has no site to take an icon from: known, so no icon rather than not found.
    assert.equal(await icons.get('beta'), null)
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

// One catalogue for the whole server, whichever request reads or changes it.
describe("the server's catalogue", () => {
  const ids = (catalog: ReturnType<SourceStore['catalog']>) =>
    catalog.topics.map(topic => [topic.id, topic.sources.map(source => source.id)])

  it('is the same catalogue for every request, each feed once', () => {
    const db = openDatabase(':memory:')
    const store = new SourceStore(db)
    store.load(file(BETA), NOW, 'fr')
    db.prepare("INSERT INTO accounts (id, name, created_at, set_up_at) VALUES (2, 'Famille Martin', ?, ?)").run(
      NOW,
      NOW
    )
    const before = ids(store.catalog(file(BETA)))
    assert.deepEqual(
      inHousehold(2, () => ids(store.catalog(file(BETA)))),
      before
    )
    // Already in the catalogue: the same row, never a second one.
    assert.equal(
      inHousehold(2, () => store.has('alpha')),
      true
    )
    assert.equal(store.findByUrl('https://alpha.example/feed')?.id, 'alpha')
    inHousehold(2, () => store.remove('alpha'))
    assert.equal(store.has('alpha'), false)
    assert.equal(count(db), 0)
  })

  it('seeds the catalogue once, in the language asked first', () => {
    const db = openDatabase(':memory:')
    const store = new SourceStore(db)
    store.seed(file(BETA), 'fr', NOW)
    inHousehold(2, () => store.seed(file(BETA), 'en', NOW))
    assert.deepEqual(ids(store.catalog(file(BETA))), [
      ['world', ['alpha']],
      ['tech', []]
    ])
    assert.equal(store.count(), 1)
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

    migrate(db, versionBefore('CREATE TABLE catalog_sources'))

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

describe('catalog_sources migration', () => {
  it("merges every household's sources into one catalogue, the first household's row first", () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    migrate(db, versionBefore('CREATE TABLE catalog_sources'))
    db.prepare("INSERT INTO accounts (id, name, created_at) VALUES (2, 'Martin', ?)").run(NOW)
    db.prepare(
      `INSERT INTO sources (id, section, section_id, topics, position, name, url, kind, lang, domains, reader, skip, added_by, created_at)
       VALUES ('alpha', 'topic', 'world', NULL, 0, 'Alpha', 'https://alpha.example/feed', 'rss', 'fr', '[]', 1, '[]', NULL, ?),
              ('blog', 'topic', 'tech', NULL, 0, 'Blog', 'https://blog.example/feed', 'rss', 'fr', '[]', 1, '[]', NULL, ?)`
    ).run(NOW, NOW)
    // Marc, of the second household, added the blog; the first household added its own feed at the same position.
    db.prepare(
      "INSERT INTO profiles (id, account_id, name, color, position, created_at) VALUES (20, 2, 'Marc', 'world', 0, ?)"
    ).run(NOW)
    db.prepare(
      `INSERT INTO sources (id, section, section_id, topics, position, name, url, kind, lang, domains, reader, skip, added_by, created_at)
       VALUES ('own', 'topic', 'tech', NULL, 0, 'Own', 'https://own.example/feed', 'rss', 'fr', '[]', 1, '[]', NULL, ?)`
    ).run(NOW)
    db.prepare(
      `INSERT INTO household_sources (household_id, source_id, section, section_id, topics, position, added_by, created_at)
       VALUES (2, 'alpha', 'topic', 'tech', '["tech"]', 4, NULL, ?),
              (1, 'alpha', 'topic', 'world', '["world"]', 0, NULL, ?),
              (1, 'own', 'topic', 'tech', '["tech"]', 3, NULL, ?),
              (2, 'blog', 'topic', 'tech', '["tech","ai"]', 3, 20, ?)`
    ).run(NOW, NOW, NOW, NOW)
    db.prepare("INSERT INTO my_sources (owner, source_id, added_at) VALUES ('a9', 'blog', ?)").run(NOW)

    migrate(db)

    assert.deepEqual(
      db
        .prepare('SELECT source_id, section_id, topics, position FROM catalog_sources ORDER BY source_id')
        .all()
        .map(row => Object.values(row)),
      [
        ['alpha', 'world', '["world"]', 0],
        ['blog', 'tech', '["tech","ai"]', 1],
        ['own', 'tech', '["tech"]', 0]
      ]
    )
    // Only the second household saw the blog: the server's admin validates it before anyone else does.
    assert.deepEqual(
      db
        .prepare('SELECT source_id, state FROM source_reviews')
        .all()
        .map(row => Object.values(row)),
      [['blog', 'pending']]
    )
    // Who reads a source stays theirs, and goes with it when it leaves the catalogue.
    db.prepare("DELETE FROM catalog_sources WHERE source_id = 'blog'").run()
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM my_sources').get()!.n, 0)
  })
})

describe('a source whose adder goes', () => {
  // Anna is the server's admin (profile 1); Paul (profile 2) added a feed.
  const start = () => {
    const db = openDatabase(':memory:')
    const store = new SourceStore(db)
    store.load(file(), NOW, 'fr')
    db.exec(`
      INSERT INTO users (id, email, password_hash, password_changed_at, created_at, server_admin)
        VALUES (1, 'anna@example.com', 'x', 0, 0, 1), (2, 'paul@example.com', 'x', 0, 0, 0), (3, 'lea@example.com', 'x', 0, 0, 0);
      UPDATE profiles SET user_id = 1 WHERE id = 1;
    `)
    const profile = (user: number, name: string) =>
      Number(
        db
          .prepare(
            "INSERT INTO profiles (account_id, name, color, position, created_at, user_id) VALUES (1, ?, 'world', 1, ?, ?)"
          )
          .run(name, NOW, user).lastInsertRowid
      )
    const paul = profile(2, 'Paul')
    const lea = profile(3, 'Léa')
    store.add({ ...file().topics[1]!.sources[0]!, addedBy: paul }, 'topic', ['tech'], NOW)
    const reads = (owner: string) =>
      db.prepare('INSERT INTO my_sources (owner, source_id, added_at) VALUES (?, ?, ?)').run(owner, 'delta', NOW)
    reads('a2')
    return { db, store, paul, lea, reads }
  }

  it('stays for those who read it, the server admin’s from then on', () => {
    const { db, store, paul, reads } = start()
    reads('a3')
    db.prepare('DELETE FROM profiles WHERE id = ?').run(paul)
    assert.equal(store.adderOf('delta'), 1)
    assert.equal(store.handOver('delta', 1), null)
  })

  it('goes with its adder when nobody else reads it', () => {
    const { db, store, paul } = start()
    db.prepare('DELETE FROM profiles WHERE id = ?').run(paul)
    assert.equal(store.adderOf('delta'), undefined)
  })

  it('is handed over when its adder removes it from the catalogue while others read it', () => {
    const { store, paul, reads } = start()
    assert.equal(store.handOver('delta', paul), null)
    reads('a3')
    assert.equal(store.handOver('delta', paul), 1)
    assert.equal(store.adderOf('delta'), 1)
  })
})
