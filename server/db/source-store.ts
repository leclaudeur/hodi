import type { Catalog, Language, Source } from '../news/catalog.ts'
import { type Database, transaction } from './database.ts'
import { readerCounts } from './my-sources.ts'
import { SELECT_FOLLOWED, type SourceRow, toSource, topicsOf } from './source-rows.ts'
import { followFileReaderOff, ownOldBaseSources, ownOldChannels, tidyOldSourceNames } from './source-upkeep.ts'

// The sources' catalogue in the database, which holds them for good. sources.yml's base sources for the server's
// language fill it once, when the server is set up (no "Vidéos" channel is a base one); its other sources are only offered ("Sources proposées") until a
// profile adds one. Then the admin removes any source and profiles add theirs, each in one topic or more (the
// topics and their labels stay in the file). Each person reads their own list of them (my-sources.ts);
// a new adult only starts with the base sources, and sources nobody reads are paused.
//
// A feed is one row of sources for the whole server, fetched once; its topics, order and adder are its row of
// catalog_sources. One catalogue for the whole server: who reads which source is each person's own (my-sources.ts).

export class SourceStore {
  readonly #db: Database
  // How many people have each source in « Mes sources ».
  readonly readers = () => readerCounts(this.#db)

  constructor(db: Database) {
    this.#db = db
  }

  // The feed's own row and its place in the catalogue.
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
        `INSERT OR IGNORE INTO sources (id, section, section_id, topics, position, name, url, kind, lang, domains, reader, skip, description, added_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
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
        source.description ?? null,
        now
      )
    this.#db
      .prepare(
        `INSERT OR IGNORE INTO catalog_sources (source_id, section, section_id, topics, position, added_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(source.id, section, sectionId, topics, position, addedBy, now)
  }

  // A server that starts: sources.yml's base sources in its language. Nothing when the catalogue already has some.
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

  // The first time: the file's base sources in the server's language.
  #seedCatalog(file: Catalog, now: number, language: Language, admin: number | null) {
    const isBase = (source: Source) => source.base?.includes(language) ?? false
    // A server older than the catalogue keeps every source it already fetched articles from: they become
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

  // Fills the catalogue with the file's base sources in the server's language the first time, then gives it as
  // the database has it. language: null before setup, which fills it once the language is known.
  load(file: Catalog, now: number, language: Language | null): Catalog {
    transaction(this.#db, () => {
      const admin = (
        this.#db.prepare("SELECT MIN(id) AS id FROM profiles WHERE role = 'admin'").get() as { id: number | null }
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
        if (admin !== null) ownOldBaseSources(this.#db, admin, file)
        this.#markSeeded('base-sources', now)
      }

      // Once, on a catalogue filled when every channel was a base one: they become the admin's own too.
      if (this.#seeded('catalog') && !this.#seeded('own-channels')) {
        if (admin !== null) ownOldChannels(this.#db, admin)
        this.#markSeeded('own-channels', now)
      }

      followFileReaderOff(this.#db, file)
    })
    return this.catalog(file)
  }

  // A source a profile added, at the end of its topics (or its section of "Vidéos"). A feed the server already
  // has is the same row, under its id: see feedOf.
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

  // The feed at this address: a source added again keeps its id.
  feedOf(url: string): Source | null {
    const row = this.#db
      .prepare(
        'SELECT id, name, url, kind, lang, domains, reader, skip, description, section, section_id, topics, NULL AS added_by FROM sources WHERE url = ?'
      )
      .get(url) as unknown as SourceRow | undefined
    return row ? toSource(row) : null
  }

  // The topics a source is listed in, the first one labelling its articles.
  setTopics(id: string, topicIds: string[]) {
    return (
      this.#db
        .prepare("UPDATE catalog_sources SET topics = ?, section_id = ? WHERE source_id = ? AND section = 'topic'")
        .run(JSON.stringify(topicIds), topicIds[0]!, id).changes > 0
    )
  }

  // A source's new name, on the articles already kept too.
  rename(id: string, name: string) {
    transaction(this.#db, () => {
      this.#db.prepare('UPDATE sources SET name = ? WHERE id = ?').run(name, id)
      this.#db.prepare('UPDATE articles SET source_name = ? WHERE source_id = ?').run(name, id)
    })
  }

  // Gone for the whole server, sources.yml's too: the file does not bring them back. The feed goes with it.
  remove(id: string) {
    return transaction(this.#db, () => {
      const gone = this.#db.prepare('DELETE FROM catalog_sources WHERE source_id = ?').run(id).changes > 0
      this.#db
        .prepare('DELETE FROM sources WHERE id = ? AND NOT EXISTS (SELECT 1 FROM catalog_sources WHERE source_id = ?)')
        .run(id, id)
      return gone
    })
  }

  // Every source of the catalogue, for its cap.
  count() {
    return (
      this.#db.prepare('SELECT COUNT(*) AS n FROM catalog_sources').get() as {
        n: number
      }
    ).n
  }

  // A feed already followed, under any name.
  findByUrl(url: string) {
    const row = this.#db.prepare(`${SELECT_FOLLOWED} WHERE s.url = ?`).get(url) as unknown as SourceRow | undefined
    return row ? toSource(row) : null
  }

  // A source its adder lets go while others read it: the server admin's from now on. Returns that profile, or null when
  // nobody else reads it or the server's admin has no other profile, and the source can go.
  handOver(id: string, from: number): number | null {
    const heir = this.#db
      .prepare(
        `SELECT p.id FROM profiles p JOIN users u ON u.id = p.user_id
         WHERE u.server_admin = 1 AND p.id != ? ORDER BY p.id LIMIT 1`
      )
      .get(from) as { id: number } | undefined
    const own = this.#db.prepare('SELECT user_id FROM profiles WHERE id = ?').get(from) as
      { user_id: number | null } | undefined
    const others = this.#db
      .prepare('SELECT 1 FROM my_sources WHERE source_id = ? AND owner != ? AND owner != ? LIMIT 1')
      .get(id, `p${from}`, `a${own?.user_id ?? 0}`)
    if (!heir || !others) return null
    this.#db.prepare('UPDATE catalog_sources SET added_by = ? WHERE source_id = ?').run(heir.id, id)
    return heir.id
  }

  // Who added a source of the catalogue now: null for sources.yml's, undefined when it is not in it.
  adderOf(id: string): number | null | undefined {
    const row = this.#db.prepare('SELECT added_by FROM catalog_sources WHERE source_id = ?').get(id) as
      { added_by: number | null } | undefined
    return row === undefined ? undefined : row.added_by
  }

  // In the catalogue.
  has(id: string) {
    return this.#db.prepare('SELECT 1 FROM catalog_sources WHERE source_id = ?').get(id) !== undefined
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
      .all() as unknown as SourceRow[]
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

  // The file's sources not yet in the catalogue ("Sources proposées"), with their topic.
  proposals(file: Catalog) {
    const urls = new Set(
      (
        this.#db.prepare('SELECT s.url FROM catalog_sources h JOIN sources s ON s.id = h.source_id').all() as {
          url: string
        }[]
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
