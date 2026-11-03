import type { Catalog, Language, Source } from '../news/catalog.ts'
import { type Database, transaction } from './database.ts'

// The sources' catalogue in the database, which holds them for good. sources.yml's base sources for the household's
// language fill it once, when the household is set up (no "Vidéos" channel is a base one); its other sources are only offered ("Sources proposées") until a
// profile adds one. Then the admin removes any source and profiles add theirs, each in one topic or more (the
// topics and their labels stay in the file). Each profile turns sources off in its preferences
// (hiddenSources); a profile only starts with the base sources, and sources nobody reads are paused.

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

const topicsOf = (row: SourceRow) =>
  row.section !== 'topic' ? [] : row.topics ? (JSON.parse(row.topics) as string[]) : [row.section_id]

export class SourceStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  #seeded(name: string) {
    return this.#db.prepare('SELECT 1 FROM seeds WHERE name = ?').get(name) !== undefined
  }

  #markSeeded(name: string, now: number) {
    this.#db.prepare('INSERT OR IGNORE INTO seeds (name, done_at) VALUES (?, ?)').run(name, now)
  }

  // Fills the catalogue with the file's base sources in the household's language the first time, then gives it as
  // the database has it. language: null before setup, which fills it once the language is known.
  load(file: Catalog, now: number, language: Language | null): Catalog {
    transaction(this.#db, () => {
      const admin = (
        this.#db.prepare("SELECT MIN(id) AS id FROM profiles WHERE role = 'admin'").get() as { id: number | null }
      ).id
      const isBase = (source: Source) => language !== null && (source.base?.includes(language) ?? false)
      if (!this.#seeded('catalog') && language !== null) {
        const write = this.#db.prepare(
          `INSERT OR IGNORE INTO sources (id, section, section_id, topics, position, name, url, kind, lang, domains, reader, skip, added_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
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
            write.run(
              source.id,
              section,
              id,
              section === 'topic' ? JSON.stringify([id]) : null,
              position,
              source.name,
              source.url,
              source.kind,
              source.lang,
              JSON.stringify(source.domains),
              source.reader ? 1 : 0,
              JSON.stringify(source.skip),
              isBase(source) ? null : admin,
              now
            )
          })
        }
        this.#markSeeded('catalog', now)
        this.#markSeeded('base-sources', now)
        this.#markSeeded('own-channels', now)
      }

      // Once, on a catalogue filled before base sources existed: every topic source that is not a base one
      // becomes the admin's own, as if added by them. The other profiles keep seeing them; new ones won't.
      if (this.#seeded('catalog') && !this.#seeded('base-sources')) {
        // Base sources then were the French ones.
        const base = file.topics.flatMap(topic =>
          topic.sources.filter(source => source.base?.includes('fr')).map(source => source.id)
        )
        if (admin !== null) {
          this.#db
            .prepare(
              `UPDATE sources SET added_by = ? WHERE added_by IS NULL AND section = 'topic'
               AND id NOT IN (SELECT value FROM json_each(?))`
            )
            .run(admin, JSON.stringify(base))
        }
        this.#markSeeded('base-sources', now)
      }

      // Once, on a catalogue filled when every channel was a base one: they become the admin's own too.
      if (this.#seeded('catalog') && !this.#seeded('own-channels')) {
        if (admin !== null) {
          this.#db.prepare("UPDATE sources SET added_by = ? WHERE added_by IS NULL AND section = 'listen'").run(admin)
        }
        this.#markSeeded('own-channels', now)
      }
    })
    return this.catalog(file)
  }

  // A source a profile added, at the end of its topics (or its section of "Vidéos").
  add(source: Source & { addedBy: number }, section: SourceRow['section'], sectionIds: string[], now: number) {
    this.#db
      .prepare(
        `INSERT INTO sources (id, section, section_id, topics, position, name, url, kind, lang, domains, reader, skip, added_by, created_at)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        source.id,
        section,
        sectionIds[0]!,
        section === 'topic' ? JSON.stringify(sectionIds) : null,
        source.name,
        source.url,
        source.kind,
        source.lang,
        JSON.stringify(source.domains),
        source.reader ? 1 : 0,
        JSON.stringify(source.skip),
        source.addedBy,
        now
      )
  }

  // The topics a source is listed in, the first one labelling its articles.
  setTopics(id: string, topicIds: string[]) {
    return (
      this.#db
        .prepare("UPDATE sources SET topics = ?, section_id = ? WHERE id = ? AND section = 'topic'")
        .run(JSON.stringify(topicIds), topicIds[0]!, id).changes > 0
    )
  }

  // Gone for the whole household, sources.yml's too: the file does not bring them back.
  remove(id: string) {
    return this.#db.prepare('DELETE FROM sources WHERE id = ?').run(id).changes > 0
  }

  // Every source of the household, for its cap.
  count() {
    return (this.#db.prepare('SELECT COUNT(*) AS n FROM sources').get() as { n: number }).n
  }

  // A feed already followed, under any name.
  findByUrl(url: string) {
    const row = this.#db.prepare('SELECT * FROM sources WHERE url = ?').get(url) as unknown as SourceRow | undefined
    return row ? toSource(row) : null
  }

  has(id: string) {
    return this.#db.prepare('SELECT 1 FROM sources WHERE id = ?').get(id) !== undefined
  }

  // The topics and sections of the file, with the sources the database has for each; a source in several
  // topics is in each of them.
  catalog(file: Catalog): Catalog {
    const rows = this.#db
      .prepare('SELECT * FROM sources ORDER BY added_by IS NOT NULL, position, created_at, id')
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

  // The file's sources not yet in the household's catalogue ("Sources proposées"), with their topic.
  proposals(file: Catalog) {
    const urls = new Set((this.#db.prepare('SELECT url FROM sources').all() as { url: string }[]).map(row => row.url))
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
