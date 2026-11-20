import type { Source } from '../news/catalog.ts'

// A source as the database holds it: its feed's row (sources) and a household's (household_sources).

export interface SourceRow {
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
  description: string | null
}

export const toSource = (row: SourceRow): Source => ({
  id: row.id,
  name: row.name,
  url: row.url,
  kind: row.kind,
  lang: row.lang,
  domains: JSON.parse(row.domains) as string[],
  reader: row.reader === 1,
  skip: JSON.parse(row.skip) as string[],
  ...(row.description ? { description: row.description } : {}),
  ...(row.added_by === null ? {} : { addedBy: row.added_by })
})

// A household's source: the feed, with that household's topics, order and adder.
export const SELECT_FOLLOWED = `SELECT s.id, s.name, s.url, s.kind, s.lang, s.domains, s.reader, s.skip, s.description, h.section, h.section_id, h.topics,
  h.added_by FROM household_sources h JOIN sources s ON s.id = h.source_id WHERE h.household_id = ?`

export const topicsOf = (row: SourceRow) =>
  row.section !== 'topic' ? [] : row.topics ? (JSON.parse(row.topics) as string[]) : [row.section_id]
