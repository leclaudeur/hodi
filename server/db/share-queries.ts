import type { Database } from './database.ts'
import type { SavedItem } from './user-store.ts'

// What one profile sends to the others' « Partages », and the reactions that come back.

// Sends an article to another profile's "Partages", with a word or not. Sent again, it comes back on top with
// the new word, unread and without the reaction to the last time.
export const shareTo = (
  db: Database,
  profile: number,
  profileId: number,
  item: { id: string },
  now: number,
  note: string | null = null
) => {
  db.prepare(
    `INSERT INTO shares (profile_id, article_id, from_profile, item, shared_at, note) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (profile_id, article_id, from_profile)
       DO UPDATE SET item = excluded.item, shared_at = excluded.shared_at, note = excluded.note, read_at = NULL,
         reaction = NULL, reacted_at = NULL, reaction_seen = 0`
  ).run(profileId, item.id, profile, JSON.stringify(item), now, note)
}

// What the other profiles sent here this week, read or not, newest first, without the articles put away.
export const shares = (
  db: Database,
  profile: number,
  since: number
): {
  item: SavedItem
  from: number
  sharedAt: number
  note: string | null
  reaction: string | null
}[] => {
  const rows = db
    .prepare(
      `SELECT item, from_profile, shared_at, note, reaction FROM shares
       WHERE profile_id = ? AND shared_at >= ?
         AND article_id NOT IN (SELECT article_id FROM read_articles WHERE profile_id = ? AND hidden = 1)
       ORDER BY shared_at DESC`
    )
    .all(profile, since, profile) as {
    item: string
    from_profile: number
    shared_at: number
    note: string | null
    reaction: string | null
  }[]
  return rows.map(row => ({
    item: JSON.parse(row.item) as SavedItem,
    from: row.from_profile,
    sharedAt: row.shared_at,
    note: row.note,
    reaction: row.reaction
  }))
}

// An emoji back to whoever sent the article, read or not; null takes it back. Returns the item, or null when
// nothing was sent, and whether the reaction changed.
export const react = (
  db: Database,
  profile: number,
  articleId: string,
  from: number,
  reaction: string | null,
  now: number
): { item: SavedItem; changed: boolean } | null => {
  const row = db
    .prepare('SELECT item, reaction FROM shares WHERE profile_id = ? AND article_id = ? AND from_profile = ?')
    .get(profile, articleId, from) as { item: string; reaction: string | null } | undefined
  if (!row) return null
  if (row.reaction !== reaction) {
    db.prepare(
      `UPDATE shares SET reaction = ?, reacted_at = ?, reaction_seen = 0
         WHERE profile_id = ? AND article_id = ? AND from_profile = ?`
    ).run(reaction, reaction === null ? null : now, profile, articleId, from)
  }
  return { item: JSON.parse(row.item) as SavedItem, changed: row.reaction !== reaction }
}

// The reactions to what this profile sent that it has not seen yet, newest first.
export const reactions = (
  db: Database,
  profile: number
): { item: SavedItem; to: number; reaction: string; reactedAt: number }[] => {
  const rows = db
    .prepare(
      `SELECT item, profile_id, reaction, reacted_at FROM shares
       WHERE from_profile = ? AND reaction IS NOT NULL AND reaction_seen = 0
       ORDER BY reacted_at DESC`
    )
    .all(profile) as { item: string; profile_id: number; reaction: string; reacted_at: number }[]
  return rows.map(row => ({
    item: JSON.parse(row.item) as SavedItem,
    to: row.profile_id,
    reaction: row.reaction,
    reactedAt: row.reacted_at
  }))
}

// Shown once in "Partages": they do not come back. Those sent after the list was read still show next time.
export const markReactionsSeen = (db: Database, profile: number, until: number) => {
  db.prepare(
    'UPDATE shares SET reaction_seen = 1 WHERE from_profile = ? AND reaction IS NOT NULL AND reacted_at <= ?'
  ).run(profile, until)
}
