import type { Database } from './database.ts'

// Mon compte for an account in no household: what it read and earned before, kept until it joins one again
// (migrations.ts, kept_readings and kept_game_events). null: nothing kept.
export interface KeptStats {
  articles: number
  videos: number
  minutes: number
  points: number
}

const VIDEO_KINDS = "('video', 'podcast')"

export const keptStatsOf = (db: Database, accountId: number): KeptStats | null => {
  // A reading counts once it is read: done is 0 only for one opened and left unfinished.
  const read = db
    .prepare(
      `SELECT COALESCE(SUM(kind NOT IN ${VIDEO_KINDS}), 0) AS articles, COALESCE(SUM(kind IN ${VIDEO_KINDS}), 0) AS videos,
       COALESCE(SUM(minutes), 0) AS minutes FROM kept_readings WHERE user_id = ? AND COALESCE(done, 1) = 1`
    )
    .get(accountId) as { articles: number; videos: number; minutes: number }
  const { points } = db
    .prepare('SELECT COALESCE(SUM(points), 0) AS points FROM kept_game_events WHERE user_id = ?')
    .get(accountId) as { points: number }
  return read.articles + read.videos + points === 0 ? null : { ...read, points }
}

// The account's copy (« Télécharger une copie ») carries them as they are.
export const keptRowsOf = (db: Database, accountId: number) => ({
  readings: db.prepare('SELECT * FROM kept_readings WHERE user_id = ?').all(accountId),
  gameEvents: db.prepare('SELECT * FROM kept_game_events WHERE user_id = ?').all(accountId)
})
