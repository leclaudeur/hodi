import { tidySourceName, withoutCountry } from '../news/source-name.ts'
import type { Catalog } from '../news/catalog.ts'
import type { Database } from './database.ts'

// What the catalogue did once, on households set up before a change; each runs once (seeds table).

// The site names tidied. Without the site's page at hand, a name may fall back to its address.
export const tidyOldSourceNames = (db: Database) => {
  const rows = db.prepare("SELECT id, name, url, domains FROM sources WHERE kind = 'article'").all() as {
    id: string
    name: string
    url: string
    domains: string
  }[]
  const rename = db.prepare('UPDATE sources SET name = ? WHERE id = ?')
  const renameArticles = db.prepare('UPDATE articles SET source_name = ? WHERE source_id = ?')
  for (const row of rows) {
    const domain = (JSON.parse(row.domains) as string[])[0]
    const site = domain ? `https://${domain}/` : row.url
    // Added from a link (p<profile>-…) the name is tidied; the file's sources keep their names but the country.
    const name = /^p\d+-/.test(row.id) ? tidySourceName(row.name, site) : withoutCountry(row.name, site)
    if (name === row.name) continue
    rename.run(name, row.id)
    renameArticles.run(name, row.id)
  }
}

// Every topic source that is not a base one becomes the admin's own, as if added by them.
export const ownOldBaseSources = (db: Database, household: number, admin: number, file: Catalog) => {
  // Base sources then were the French ones.
  const base = file.topics.flatMap(topic =>
    topic.sources.filter(source => source.base?.includes('fr')).map(source => source.id)
  )
  db.prepare(
    `UPDATE household_sources SET added_by = ? WHERE household_id = ? AND added_by IS NULL
         AND section = 'topic' AND source_id NOT IN (SELECT value FROM json_each(?))`
  ).run(admin, household, JSON.stringify(base))
}

// Every channel becomes the admin's own.
export const ownOldChannels = (db: Database, household: number, admin: number) => {
  db.prepare(
    "UPDATE household_sources SET added_by = ? WHERE household_id = ? AND added_by IS NULL AND section = 'listen'"
  ).run(admin, household)
}

// A site sources.yml now says Hodi cannot read (reader: false, a bot wall) is no longer read on an install that
// already follows it either: its articles show their summary and a link, instead of being hidden as unreadable.
// Matched by feed address, so a profile's own copy of that feed is turned too. Runs at every start, as the file may
// change with any update.
export const followFileReaderOff = (db: Database, file: Catalog) => {
  const turnOff = db.prepare('UPDATE sources SET reader = 0 WHERE url = ? AND reader = 1')
  for (const source of file.topics.flatMap(topic => topic.sources)) {
    if (!source.reader) turnOff.run(source.url)
  }
}
