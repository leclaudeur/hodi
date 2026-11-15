import type { Database } from './database.ts'
import type { Reading, ReadingKind, ReadingProgress } from './user-store.ts'

// What one profile opened: articles, videos and episodes, how far it went, and « Reprendre ».

const trackedColumns = (reading: Reading) =>
  reading.done === undefined
    ? [null, null, null, null]
    : [reading.done ? 1 : 0, reading.progress ?? 0, reading.position ?? 0, reading.estimate ?? 0]

// Each article counts once, on the day it was first opened.
export const insertReadings = (db: Database, profile: number, readings: Reading[]) => {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO readings
     (profile_id, article_id, source_id, source_name, topic_id, minutes, read_at, kind, done, progress, position, estimate)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  readings.forEach(reading =>
    insert.run(
      profile,
      reading.id,
      reading.sourceId,
      reading.sourceName,
      reading.topicId,
      reading.minutes,
      reading.at,
      reading.kind,
      ...trackedColumns(reading)
    )
  )
}

// Every reading of the profile, oldest first, as the app keeps them.
export const readingsOf = (db: Database, profile: number): Reading[] => {
  const rows = db
    .prepare(
      `SELECT article_id, source_id, source_name, topic_id, minutes, read_at, kind, done, progress, position, estimate
       FROM readings WHERE profile_id = ? ORDER BY read_at`
    )
    .all(profile) as {
    article_id: string
    source_id: string
    source_name: string
    topic_id: string | null
    minutes: number
    read_at: number
    kind: ReadingKind
    done: number | null
    progress: number | null
    position: number | null
    estimate: number | null
  }[]
  return rows.map(row => ({
    id: row.article_id,
    sourceId: row.source_id,
    sourceName: row.source_name,
    topicId: row.topic_id,
    minutes: row.minutes,
    at: row.read_at,
    kind: row.kind,
    ...(row.done === null
      ? {}
      : {
          done: row.done === 1,
          progress: row.progress ?? 0,
          position: row.position ?? 0,
          estimate: row.estimate ?? 0
        })
  }))
}

// Nothing for an entry not tracked (a video, or one from before): it stays counted as read.
export const updateReadingRow = (db: Database, profile: number, id: string, change: ReadingProgress) => {
  db.prepare(
    `UPDATE readings SET minutes = MAX(minutes, ?), progress = MAX(progress, ?), position = ?, done = MAX(done, ?),
     estimate = COALESCE(?, estimate)
     WHERE profile_id = ? AND article_id = ? AND done IS NOT NULL`
  ).run(change.minutes, change.progress, change.position, change.done ? 1 : 0, change.estimate ?? null, profile, id)
}

// "Reprendre": articles, videos and episodes started but not read or seen for good, newest first, that were not
// taken off it. An article scrolled past maxProgress without the time to read it was skimmed to its end: nothing
// left to pick up there.
export const resumableReadings = (
  db: Database,
  profile: number,
  { since, minProgress, maxProgress, limit }: { since: number; minProgress: number; maxProgress: number; limit: number }
): { id: string; kind: ReadingKind; progress: number; position: number; estimate: number }[] => {
  const rows = db
    .prepare(
      `SELECT article_id, kind, progress, position, estimate FROM readings
       WHERE profile_id = ? AND done = 0 AND set_aside = 0 AND read_at >= ? AND progress >= ?
         AND (kind != 'article' OR progress < ?)
       ORDER BY read_at DESC LIMIT ?`
    )
    .all(profile, since, minProgress, maxProgress, limit) as {
    article_id: string
    kind: ReadingKind
    progress: number
    position: number
    estimate: number
  }[]
  return rows.map(row => ({
    id: row.article_id,
    kind: row.kind,
    progress: row.progress,
    position: row.position,
    estimate: row.estimate
  }))
}

// When this profile first opened something, or null.
export const firstReadingAt = (db: Database, profile: number): number | null => {
  const row = db.prepare('SELECT MIN(read_at) AS first FROM readings WHERE profile_id = ?').get(profile) as
    { first: number | null } | undefined
  return row?.first ?? null
}

// Articles and videos opened since then, by source.
export const readingsBySource = (db: Database, profile: number, since: number): Map<string, number> => {
  const rows = db
    .prepare(
      'SELECT source_id, COUNT(*) AS count FROM readings WHERE profile_id = ? AND read_at >= ? GROUP BY source_id'
    )
    .all(profile, since) as { source_id: string; count: number }[]
  return new Map(rows.map(row => [row.source_id, row.count]))
}
