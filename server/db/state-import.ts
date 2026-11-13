import type { Database } from './database.ts'
import { insertReadings } from './reading-queries.ts'
import type { Reading, SavedArticleText, SavedEntry } from './user-store.ts'

export interface ImportedState {
  preferences: Record<string, unknown> | null
  saved: (SavedEntry & { article: SavedArticleText | null })[]
  read: string[]
  readings: Reading[]
}

// What a device kept before the database existed joins what is here; nothing here is replaced.
export const importStateRows = (db: Database, profile: number, incoming: ImportedState, now: number) => {
  if (incoming.preferences) {
    db.prepare(
      "INSERT OR IGNORE INTO profile_settings (profile_id, key, value, updated_at) VALUES (?, 'preferences', ?, ?)"
    ).run(profile, JSON.stringify(incoming.preferences), now)
  }
  const save = db.prepare(
    'INSERT OR IGNORE INTO saved_articles (profile_id, article_id, item, article, saved_at) VALUES (?, ?, ?, ?, ?)'
  )
  incoming.saved.forEach(entry =>
    save.run(
      profile,
      entry.item.id,
      JSON.stringify(entry.item),
      entry.article ? JSON.stringify(entry.article) : null,
      Date.parse(entry.savedAt) || now
    )
  )
  // Oldest first in the import, so the order of reads is kept.
  const read = db.prepare('INSERT OR IGNORE INTO read_articles (profile_id, article_id, read_at) VALUES (?, ?, ?)')
  incoming.read.forEach((id, index) => read.run(profile, id, now - (incoming.read.length - index)))
  insertReadings(db, profile, incoming.readings)
}
