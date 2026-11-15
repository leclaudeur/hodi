import { type Language, isLanguage } from '../../shared/i18n.ts'
import type { Database } from './database.ts'

// The AI's traces in the database: each Résumé du jour, and every call counted against the daily caps.

export interface StoredDailySummary<Point> {
  points: Point[]
  generatedAt: string
  createdAt: number
  // The language it is written in.
  language: Language
}

export type AiCallKind = 'summary' | 'question' | 'dailySummary' | 'sources' | 'plugin'

// One call to the API, by the profile whose click asked for it.
export interface AiCall {
  kind: AiCallKind
  at: number
  profileId: number
  // A plugin's call (kind 'plugin'): which plugin asked.
  pluginId?: string
  // Put back to 0 by the admin: 'profile', it no longer counts for its profile but still for the household;
  // 'all', for no one.
  cleared?: AiCleared
}

export type AiCleared = 'profile' | 'all'

const CLEARED_LEVELS = { profile: 1, all: 2 } as const

// Each profile's last Résumé du jour.
export const latestDailySummaries = <Point>(db: Database): Map<number, StoredDailySummary<Point>> => {
  const rows = db
    .prepare(
      `SELECT profile_id, points, generated_at, language, MAX(created_at) AS created_at
       FROM daily_summaries GROUP BY profile_id`
    )
    .all() as { profile_id: number; points: string; generated_at: string; language: string; created_at: number }[]

  return new Map(
    rows.map(row => [
      row.profile_id,
      {
        points: JSON.parse(row.points) as Point[],
        generatedAt: row.generated_at,
        createdAt: row.created_at,
        language: isLanguage(row.language) ? row.language : 'fr'
      }
    ])
  )
}

export const saveDailySummary = <Point>(db: Database, dailySummary: StoredDailySummary<Point>, profileId: number) => {
  db.prepare(
    'INSERT INTO daily_summaries (points, generated_at, created_at, profile_id, language) VALUES (?, ?, ?, ?, ?)'
  ).run(
    JSON.stringify(dailySummary.points),
    dailySummary.generatedAt,
    dailySummary.createdAt,
    profileId,
    dailySummary.language
  )
}

export const recordAiCall = (db: Database, call: AiCall) => {
  db.prepare('INSERT INTO ai_calls (kind, at, profile_id, plugin_id) VALUES (?, ?, ?, ?)').run(
    call.kind,
    call.at,
    call.profileId,
    call.pluginId ?? null
  )
}

// The calls made since the given time, oldest first.
export const aiCalls = (db: Database, since: number): AiCall[] => {
  const rows = db
    .prepare('SELECT kind, at, profile_id, plugin_id, cleared FROM ai_calls WHERE at > ? ORDER BY at')
    .all(since) as unknown as {
    kind: AiCallKind
    at: number
    profile_id: number
    plugin_id: string | null
    cleared: number
  }[]

  return rows.map(row => ({
    kind: row.kind,
    at: row.at,
    profileId: row.profile_id,
    ...(row.plugin_id ? { pluginId: row.plugin_id } : {}),
    ...(row.cleared === CLEARED_LEVELS.all
      ? { cleared: 'all' as const }
      : row.cleared === CLEARED_LEVELS.profile
        ? { cleared: 'profile' as const }
        : {})
  }))
}

// "Remettre à 0": the calls since then, of one kind or all, of one profile or all, cleared to that level (never
// lowered).
export const clearAiCalls = (
  db: Database,
  since: number,
  level: AiCleared,
  kind: AiCallKind | null,
  profileId: number | null
) => {
  db.prepare(
    `UPDATE ai_calls SET cleared = ? WHERE at > ? AND cleared < ?
       AND (? IS NULL OR kind = ?) AND (? IS NULL OR profile_id = ?)`
  ).run(CLEARED_LEVELS[level], since, CLEARED_LEVELS[level], kind, kind, profileId, profileId)
}
