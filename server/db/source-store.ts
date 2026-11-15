import type { Catalog, Language, Source } from '../news/catalog.ts'
import { type Database, transaction } from './database.ts'
import { currentHouseholdId } from './household-scope.ts'
import { followFileReaderOff, ownOldBaseSources, ownOldChannels, tidyOldSourceNames } from './source-upkeep.ts'

// The sources' catalogue in the database, which holds them for good. sources.yml's base sources for the household's
// language fill it once, when the household is set up (no "Vidéos" channel is a base one); its other sources are only offered ("Sources proposées") until a
// profile adds one. Then the admin removes any source and profiles add theirs, each in one topic or more (the
// topics and their labels stay in the file). Each profile turns sources off in its preferences
// (hiddenSources); a profile only starts with the base sources, and sources nobody reads are paused.
//
// A feed is one row of sources for the whole server, fetched once. Which household follows it, in which topics and
// added by whom is that household's row of household_sources: every method here is for the household of the request
// (household-scope.ts).

interface SourceRow {
  id: string
  section: 'topic' | 'listen'
  section_id: string
  topics: string | null
  name: string
  url: string
  kind: Source['kind']
  lang: Source['lang']
  domains: string
  reader: number
  skip: string
  added_by: number | null
}

const toSource = (row: SourceRow): Source => ({
  id: row.id,
  name: row.name,
  url: row.url,
  kind: row.kind,
  lang: row.lang,
  domains: JSON.parse(row.domains) as string[],
  reader: row.reader === 1,
  skip: JSON.parse(row.skip) as string[],
  ...(row.added_by === null ? {} : { addedBy: row.added_by })
})

// A household's source: the feed, with that household's topics, order and adder.
const SELECT_FOLLOWED = `SELECT s.id, s.name, s.url, s.kind, s.lang, s.domains, s.reader, s.skip, h.section, h.section_id, h.topics,
  h.added_by FROM household_sources h JOIN sources s ON s.id = h.source_id WHERE h.household_id = ?`

const topicsOf = (row: SourceRow) =>
  row.section !== 'topic' ? [] : row.topics ? (JSON.parse(row.topics) as string[]) : [row.section_id]

export class SourceStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  get #household() {
    return currentHouseholdId()
  }

  // The feed's own row, once for the server, and this household's.
  #follow(
    source: Source,
    {
      section,
      sectionId,
      topics,
      position,
      addedBy,
      now
    }: {
      section: SourceRow['section']
      sectionId: string
      topics: string | null
      position: number
      addedBy: number | null
      now: number
    }
  ) {
    this.#db
      .prepare(
        `INSERT OR IGNORE INTO sources (id, section, section_id, topics, position, name, url, kind, lang, domains, reader, skip, added_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
      )
      .run(
        source.id,
        section,
        sectionId,
        topics,
        position,
        source.name,
        source.url,
        source.kind,
        source.lang,
        JSON.stringify(source.domains),
        source.reader ? 1 : 0,
        JSON.stringify(source.skip),
        now
      )
    this.#db
      .prepare(
        `INSERT OR IGNORE INTO household_sources (household_id, source_id, section, section_id, topics, position, added_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(this.#household, source.id, section, sectionId, topics, position, addedBy, now)
  }

  // A household that starts (the core's first one at its setup, or one a plugin makes): sources.yml's base sources in
  // its language. Nothing when it already follows some.
  seed(file: Catalog, language: Language, now: number) {
    transaction(this.#db, () => {
      if (this.count() > 0) return
      for (const topic of file.topics) {
        topic.sources
          .filter(source => source.base?.includes(language))
          .forEach((source, position) =>
            this.#follow(source, {
              section: 'topic',
              sectionId: topic.id,
              topics: JSON.stringify([topic.id]),
              position,
              addedBy: null,
              now
            })
          )
      }
    })
  }

  #seeded(name: string) {
    return this.#db.prepare('SELECT 1 FROM seeds WHERE name = ?').get(name) !== undefined
  }

  #markSeeded(name: string, now: number) {
    this.#db.prepare('INSERT OR IGNORE INTO seeds (name, done_at) VALUES (?, ?)').run(name, now)
  }

  // The first time: the file's base sources in the household's language.
  #seedCatalog(file: Catalog, now: number, language: Language, admin: number | null) {
    const isBase = (source: Source) => source.base?.includes(language) ?? false
    // A household older than the catalogue keeps every source it already fetched articles from: they become
    // its admin's own. A new one starts with the base sources only.
    const fetched = new Set(
      admin === null
        ? []
        : (this.#db.prepare('SELECT DISTINCT source_id FROM articles').all() as { source_id: string }[]).map(
            row => row.source_id
          )
    )
    const sections = [
      ...file.topics.map(topic => ({
        section: 'topic',
        id: topic.id,
        sources: topic.sources.filter(source => isBase(source) || fetched.has(source.id))
      })),
      ...file.listen.map(listen => ({
        section: 'listen',
        id: listen.id,
        sources: listen.sources.filter(source => fetched.has(source.id))
      }))
    ]
    for (const { section, id, sources } of sections) {
      sources.forEach((source, position) => {
        this.#follow(source, {
          section: section as SourceRow['section'],
          sectionId: id,
          topics: section === 'topic' ? JSON.stringify([id]) : null,
          position,
          addedBy: isBase(source) ? null : admin,
          now
        })
      })
    }
    this.#markSeeded('catalog', now)
    this.#markSeeded('base-sources', now)
    this.#markSeeded('own-channels', now)
  }

  // Fills the catalogue with the file's base sources in the household's language the first time, then gives it as
  // the database has it. language: null before setup, which fills it once the language is known.
  load(file: Catalog, now: number, language: Language | null): Catalog {
    transaction(this.#db, () => {
      const admin = (
        this.#db
          .prepare("SELECT MIN(id) AS id FROM profiles WHERE role = 'admin' AND account_id = ?")
          .get(this.#household) as { id: number | null }
      ).id
      if (!this.#seeded('catalog') && language !== null) this.#seedCatalog(file, now, language, admin)

      // Once: the names of the sites added before names were tidied ("https://www.voici.fr : flux d'articles"),
      // in the lists already shown too. Without the site's page at hand, a name may fall back to its address.
      // Twice: the first pass read a feed's own address as the site (feed.prismamediadigital.com for Voici), and
      // names then still said the country ("Marie Claire Belgique"). The site is the source's first domain.
      if (!this.#seeded('tidy-names-2')) {
        tidyOldSourceNames(this.#db)
        this.#markSeeded('tidy-names', now)
        this.#markSeeded('tidy-names-2', now)
      }

      // Once, on a catalogue filled before base sources existed: every topic source that is not a base one
      // becomes the admin's own, as if added by them. The other profiles keep seeing them; new ones won't.
      if (this.#seeded('catalog') && !this.#seeded('base-sources')) {
        if (admin !== null) ownOldBaseSources(this.#db, this.#household, admin, file)
        this.#markSeeded('base-sources', now)
      }

      // Once, on a catalogue filled when every channel was a base one: they become the admin's own too.
      if (this.#seeded('catalog') && !this.#seeded('own-channels')) {
        if (admin !== null) ownOldChannels(this.#db, this.#household, admin)
        this.#markSeeded('own-channels', now)
      }

      followFileReaderOff(this.#db, file)
    })
    return this.catalog(file)
  }

  // A source a profile added, at the end of its topics (or its section of "Vidéos"). A feed another household
  // already follows is the same row, under its id: see feedOf.
  add(source: Source & { addedBy: number }, section: SourceRow['section'], sectionIds: string[], now: number) {
    this.#follow(source, {
      section,
      sectionId: sectionIds[0]!,
      topics: section === 'topic' ? JSON.stringify(sectionIds) : null,
      position: 0,
      addedBy: source.addedBy,
      now
    })
  }

  // The feed at this address, followed by any household: a source added again by another one keeps its id.
  feedOf(url: string): Source | null {
    const row = this.#db
      .prepare(
        'SELECT id, name, url, kind, lang, domains, reader, skip, section, section_id, topics, NULL AS added_by FROM sources WHERE url = ?'
      )
      .get(url) as unknown as SourceRow | undefined
    return row ? toSource(row) : null
  }

  // The topics a source is listed in, the first one labelling its articles.
  setTopics(id: string, topicIds: string[]) {
    return (
      this.#db
        .prepare(
          "UPDATE household_sources SET topics = ?, section_id = ? WHERE household_id = ? AND source_id = ? AND section = 'topic'"
        )
        .run(JSON.stringify(topicIds), topicIds[0]!, this.#household, id).changes > 0
    )
  }

  // A source's new name, on the articles already kept too.
  rename(id: string, name: string) {
    transaction(this.#db, () => {
      this.#db.prepare('UPDATE sources SET name = ? WHERE id = ?').run(name, id)
      this.#db.prepare('UPDATE articles SET source_name = ? WHERE source_id = ?').run(name, id)
    })
  }

  // Gone for the whole household, sources.yml's too: the file does not bring them back. The feed itself goes once
  // no household follows it.
  remove(id: string) {
    return transaction(this.#db, () => {
      const gone =
        this.#db
          .prepare('DELETE FROM household_sources WHERE household_id = ? AND source_id = ?')
          .run(this.#household, id).changes > 0
      this.#db
        .prepare(
          'DELETE FROM sources WHERE id = ? AND NOT EXISTS (SELECT 1 FROM household_sources WHERE source_id = ?)'
        )
        .run(id, id)
      return gone
    })
  }

  // Every source of the household, for its cap.
  count() {
    return (
      this.#db.prepare('SELECT COUNT(*) AS n FROM household_sources WHERE household_id = ?').get(this.#household) as {
        n: number
      }
    ).n
  }

  // A feed already followed, under any name.
  findByUrl(url: string) {
    const row = this.#db.prepare(`${SELECT_FOLLOWED} AND s.url = ?`).get(this.#household, url) as unknown as
      SourceRow | undefined
    return row ? toSource(row) : null
  }

  // Followed by this household.
  has(id: string) {
    return (
      this.#db
        .prepare('SELECT 1 FROM household_sources WHERE household_id = ? AND source_id = ?')
        .get(this.#household, id) !== undefined
    )
  }

  // An id no feed of the server has yet, for a new source.
  isTaken(id: string) {
    return this.#db.prepare('SELECT 1 FROM sources WHERE id = ?').get(id) !== undefined
  }

  // The topics and sections of the file, with the sources the database has for each; a source in several
  // topics is in each of them.
  catalog(file: Catalog): Catalog {
    const rows = this.#db
      .prepare(`${SELECT_FOLLOWED} ORDER BY h.added_by IS NOT NULL, h.position, h.created_at, s.id`)
      .all(this.#household) as unknown as SourceRow[]
    const sources = new Map(rows.map(row => [row.id, toSource(row)]))
    return {
      topics: file.topics.map(topic => ({
        ...topic,
        sources: rows.filter(row => topicsOf(row).includes(topic.id)).map(row => sources.get(row.id)!)
      })),
      listen: file.listen.map(section => ({
        ...section,
        sources: rows
          .filter(row => row.section === 'listen' && row.section_id === section.id)
          .map(row => sources.get(row.id)!)
      }))
    }
  }

  // The file's sources not yet in the household's catalogue ("Sources proposées"), with their topic.
  proposals(file: Catalog) {
    const urls = new Set(
      (
        this.#db
          .prepare(
            'SELECT s.url FROM household_sources h JOIN sources s ON s.id = h.source_id WHERE h.household_id = ?'
          )
          .all(this.#household) as { url: string }[]
      ).map(row => row.url)
    )
    return file.topics.flatMap(topic =>
      topic.sources
        // The young readers' own are their parents' to turn on, never offered to the adults.
        .filter(source => source.adults !== false && !this.has(source.id) && !urls.has(source.url))
        .map(source => ({ source, topicId: topic.id }))
    )
  }
}

// Sources that every profile turned off: nobody reads them, so their feeds are not fetched.
// Asked often (each list), so the answer is kept a minute.
export const createPauseCheck = ({
  hiddenByProfile,
  now,
  ttlMs = 60 * 1000
}: {
  // Each profile's hidden sources.
  hiddenByProfile: () => string[][]
  now: () => number
  ttlMs?: number
}) => {
  let paused = new Set<string>()
  let checkedAt = -Infinity
  return (sourceId: string) => {
    if (now() - checkedAt > ttlMs) {
      const lists = hiddenByProfile()
      paused =
        lists.length === 0 ? new Set() : new Set(lists[0]!.filter(id => lists.every(hidden => hidden.includes(id))))
      checkedAt = now()
    }
    return paused.has(sourceId)
  }
}
