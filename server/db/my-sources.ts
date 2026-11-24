import type { Database } from './database.ts'

// « Mes sources »: the sources a person reads, their account's or a young profile's (stats-owner.ts). The server's
// catalogue holds every source; a source someone adds is theirs alone until others add it too.

export const mySources = (db: Database, owner: string) =>
  (db.prepare('SELECT source_id FROM my_sources WHERE owner = ?').all(owner) as { source_id: string }[]).map(
    row => row.source_id
  )

export const addMySources = (db: Database, owner: string, ids: string[], now: number) => {
  const insert = db.prepare('INSERT OR IGNORE INTO my_sources (owner, source_id, added_at) VALUES (?, ?, ?)')
  return ids.filter(id => insert.run(owner, id, now).changes > 0).length
}

export const removeMySource = (db: Database, owner: string, id: string) =>
  db.prepare('DELETE FROM my_sources WHERE owner = ? AND source_id = ?').run(owner, id).changes > 0

// The catalogue's sources this person does not read, which every list and alert leaves out. The app still reads
// them as the preferences' hiddenSources.
export const sourcesOff = (db: Database, owner: string) =>
  (
    db
      .prepare(
        `SELECT source_id FROM catalog_sources WHERE source_id NOT IN (SELECT source_id FROM my_sources WHERE owner = ?)
         ORDER BY created_at, rowid`
      )
      .all(owner) as { source_id: string }[]
  ).map(row => row.source_id)

// Their preferences as the app reads them, with the sources outside « Mes sources » as hiddenSources (none: no key,
// which the app reads as none).
export const withSourcesOff = (preferences: Record<string, unknown> | null, off: string[]) =>
  off.length === 0 ? preferences : { ...preferences, hiddenSources: off }

// One person's list, each change through write so their devices hear of it.
export const sourcesOf = (db: Database, owner: string, write: (now: number, fn: () => void) => number) => ({
  mine: () => mySources(db, owner),
  off: () => sourcesOff(db, owner),
  // Whether they have a list yet: a new person starts with the base sources.
  any: () => db.prepare('SELECT 1 FROM my_sources WHERE owner = ? LIMIT 1').get(owner) !== undefined,
  add: (ids: string[], now: number) => write(now, () => void addMySources(db, owner, ids, now)),
  remove: (id: string, now: number) => write(now, () => void removeMySource(db, owner, id)),
  // A source came into the catalogue: it is one more off for them, which their devices hear of.
  catalogueChanged: (now: number) => write(now, () => {})
})

// How many people read each source, for its counter.
export const readerCounts = (db: Database) =>
  new Map(
    (
      db.prepare('SELECT source_id, COUNT(*) AS n FROM my_sources GROUP BY source_id').all() as {
        source_id: string
        n: number
      }[]
    ).map(row => [row.source_id, row.n])
  )
