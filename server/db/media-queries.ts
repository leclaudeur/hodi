import type { Database } from './database.ts'

// Sources' icons and videos' lengths, fetched once and kept.

// A source's icon; data null when its site has none.
export interface StoredIcon {
  contentType: string | null
  data: Uint8Array | null
  fetchedAt: number
}

export const getIcon = (db: Database, sourceId: string): StoredIcon | null => {
  const row = db
    .prepare('SELECT content_type, data, fetched_at FROM source_icons WHERE source_id = ?')
    .get(sourceId) as { content_type: string | null; data: Uint8Array | null; fetched_at: number } | undefined

  return row ? { contentType: row.content_type, data: row.data, fetchedAt: row.fetched_at } : null
}

export const saveIcon = (db: Database, sourceId: string, icon: StoredIcon) => {
  db.prepare('INSERT OR REPLACE INTO source_icons (source_id, content_type, data, fetched_at) VALUES (?, ?, ?, ?)').run(
    sourceId,
    icon.contentType,
    icon.data,
    icon.fetchedAt
  )
}

// Known lengths, and the videos last asked about since then (not found, or not at all yet: absent).
export const getVideoDurations = (db: Database, videoIds: string[], retryAfter: number): Map<string, number | null> => {
  const found = new Map<string, number | null>()
  const select = db.prepare('SELECT seconds, fetched_at FROM video_durations WHERE video_id = ?')
  for (const id of videoIds) {
    const row = select.get(id) as { seconds: number | null; fetched_at: number } | undefined
    if (row && (row.seconds !== null || row.fetched_at >= retryAfter)) found.set(id, row.seconds)
  }
  return found
}

export const saveVideoDuration = (db: Database, videoId: string, seconds: number | null, now: number) => {
  db.prepare(
    `INSERT INTO video_durations (video_id, seconds, fetched_at) VALUES (?, ?, ?)
       ON CONFLICT (video_id) DO UPDATE SET seconds = excluded.seconds, fetched_at = excluded.fetched_at`
  ).run(videoId, seconds, now)
}
