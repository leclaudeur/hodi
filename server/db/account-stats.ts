import type { Database } from './database.ts'
import { accountOwner } from './stats-owner.ts'

// An account's reading stats and points, which are its own in any household (stats-owner.ts). Mon compte shows them
// to an account in no household; null: nothing yet.
export interface AccountStats {
  articles: number
  videos: number
  minutes: number
  points: number
}

const VIDEO_KINDS = "('video', 'podcast')"

export const accountStatsOf = (db: Database, accountId: number): AccountStats | null => {
  const owner = accountOwner(accountId)
  // A reading counts once it is read: done is 0 only for one opened and left unfinished.
  const read = db
    .prepare(
      `SELECT COALESCE(SUM(kind NOT IN ${VIDEO_KINDS}), 0) AS articles, COALESCE(SUM(kind IN ${VIDEO_KINDS}), 0) AS videos,
       COALESCE(SUM(minutes), 0) AS minutes FROM readings WHERE owner = ? AND COALESCE(done, 1) = 1`
    )
    .get(owner) as { articles: number; videos: number; minutes: number }
  const { points } = db
    .prepare('SELECT COALESCE(SUM(points), 0) AS points FROM game_events WHERE owner = ?')
    .get(owner) as { points: number }
  return read.articles + read.videos + points === 0 ? null : { ...read, points }
}

// The account's copy (« Télécharger une copie ») carries them as they are.
export const accountStatRowsOf = (db: Database, accountId: number) => ({
  readings: db.prepare('SELECT * FROM readings WHERE owner = ?').all(accountOwner(accountId)),
  gameEvents: db.prepare('SELECT * FROM game_events WHERE owner = ?').all(accountOwner(accountId))
})
