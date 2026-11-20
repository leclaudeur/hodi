import type { Source } from '../news/catalog.ts'
import type { Database } from './database.ts'
import { ownerOf } from './stats-owner.ts'

// The sources an account had on in its last household, kept by the database when its profile went
// (profiles_carry_sources): the next household it joins gets each one back, once.

export interface CarriedSource {
  source: Source
  section: 'topic' | 'listen'
  sectionIds: string[]
}

interface CarriedRow {
  id: string
  name: string
  url: string
  kind: Source['kind']
  lang: Source['lang']
  domains: string[]
  reader: number
  skip: string[]
  section: 'topic' | 'listen'
  sectionId: string
  topics: string[] | null
}

const carriedOf = (row: CarriedRow): CarriedSource => ({
  source: {
    id: row.id,
    name: row.name,
    url: row.url,
    kind: row.kind,
    lang: row.lang,
    domains: row.domains,
    reader: row.reader === 1,
    skip: row.skip
  },
  section: row.section,
  sectionIds: row.section === 'topic' && row.topics?.length ? row.topics : [row.sectionId]
})

export class CarriedSources {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  // What the profile's account carries, taken: asked again, it has nothing.
  take(profileId: number): CarriedSource[] {
    const owner = ownerOf(this.#db, profileId)
    const row = this.#db
      .prepare("SELECT value FROM profile_settings WHERE owner = ? AND key = 'carried_sources'")
      .get(owner) as { value: string } | undefined
    if (!row) return []
    this.#db.prepare("DELETE FROM profile_settings WHERE owner = ? AND key = 'carried_sources'").run(owner)
    return (JSON.parse(row.value) as CarriedRow[]).map(carriedOf)
  }
}
