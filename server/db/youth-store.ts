import type { Source } from '../news/catalog.ts'
import { dayOf, dayRange } from '../news/days.ts'
import { type Database, transaction } from './database.ts'
import { HEARTBEAT_MS, MINUTE_MS } from '../../shared/time.ts'

// What the parents set for a young profile (its fiche in Réglages > Profils), and the time it spent reading
// today. Everything is judged here, with the server's clock and the household's time zone, never the device's.

export const MIN_DAILY_MINUTES = 5
export const MAX_DAILY_MINUTES = 240
export const DAILY_MINUTES_STEP = 5
export const MAX_EXPLAIN_PER_DAY = 20
export const DEFAULT_EXPLAIN_PER_DAY = 5

// A silence longer than a few heartbeats counts for nothing: the device slept, or the app was in the background.
const MAX_GAP_MS = 3 * HEARTBEAT_MS

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

export interface TimeRange {
  // "HH:MM" in the household's time zone.
  start: string
  end: string
}

export interface YouthRules {
  // null: no limit.
  dailyMinutes: number | null
  // When the app opens; null: all day. Within one day (start before end).
  window: TimeRange | null
  // "Ne pas déranger": no notification then; null: none. May span midnight.
  quiet: TimeRange | null
  // "Explique-moi" calls a day.
  explainPerDay: number
}

// open: it reads. before: the window has not started; after: it has ended; time_up: today's minutes are spent.
export type Access = 'open' | 'before' | 'after' | 'time_up'

export interface Limits {
  rules: YouthRules
  usedSeconds: number
  // null: no daily limit. While open, never past the end of its hours.
  remainingSeconds: number | null
  access: Access
  // When it opens again (ms), when it is not open.
  opensAt: number | null
  // When it closes (ms), when it is open and something closes it today.
  closesAt: number | null
}

const DEFAULT_RULES: YouthRules = {
  dailyMinutes: null,
  window: null,
  quiet: null,
  explainPerDay: DEFAULT_EXPLAIN_PER_DAY
}

export const isTime = (value: unknown): value is string => typeof value === 'string' && TIME_PATTERN.test(value)

export const minutesOf = (time: string) => {
  const [hours, minutes] = time.split(':').map(Number)
  return (hours ?? 0) * 60 + (minutes ?? 0)
}

export const isDailyMinutes = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= MIN_DAILY_MINUTES &&
  value <= MAX_DAILY_MINUTES &&
  value % DAILY_MINUTES_STEP === 0

// Whether that instant falls in the range, in the time zone; a range may span midnight.
export const inRange = (range: TimeRange, at: number, timeZone: string) => {
  const start = minutesOf(range.start)
  const end = minutesOf(range.end)
  if (start === end) return false
  const current = minuteOfDay(at, timeZone)
  return start < end ? current >= start && current < end : current >= start || current < end
}

const minuteOfDay = (at: number, timeZone: string) => {
  const midnight = Date.parse(dayRange(dayOf(at, timeZone), timeZone)!.start)
  return Math.floor((at - midnight) / MINUTE_MS)
}

// A source a teen asked for ("Demander une source"), as found from its link, until a parent answers.
export interface SourceRequest {
  id: number
  profileId: number
  source: Source
  status: 'pending' | 'accepted' | 'refused'
  at: number
}

// A request its parents answered: when.
export interface SourceAnswer extends SourceRequest {
  status: 'accepted' | 'refused'
  decidedAt: number
}

interface RulesRow {
  daily_minutes: number | null
  window_start: string | null
  window_end: string | null
  quiet_start: string | null
  quiet_end: string | null
  explain_per_day: number
}

const rangeOf = (start: string | null, end: string | null) => (start && end ? { start, end } : null)

export class YouthStore {
  readonly #db: Database
  readonly #timeZone: () => string

  constructor(db: Database, timeZone: () => string) {
    this.#db = db
    this.#timeZone = timeZone
  }

  rules(profileId: number): YouthRules {
    const row = this.#db
      .prepare(
        'SELECT daily_minutes, window_start, window_end, quiet_start, quiet_end, explain_per_day FROM youth_rules WHERE profile_id = ?'
      )
      .get(profileId) as RulesRow | undefined
    if (!row) return { ...DEFAULT_RULES }
    return {
      dailyMinutes: row.daily_minutes,
      window: rangeOf(row.window_start, row.window_end),
      quiet: rangeOf(row.quiet_start, row.quiet_end),
      explainPerDay: row.explain_per_day
    }
  }

  // Only what is given changes.
  setRules(profileId: number, change: Partial<YouthRules>) {
    const rules = { ...this.rules(profileId), ...change }
    this.#db
      .prepare(
        `INSERT INTO youth_rules (profile_id, daily_minutes, window_start, window_end, quiet_start, quiet_end, explain_per_day)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (profile_id) DO UPDATE SET daily_minutes = excluded.daily_minutes,
           window_start = excluded.window_start, window_end = excluded.window_end, quiet_start = excluded.quiet_start,
           quiet_end = excluded.quiet_end, explain_per_day = excluded.explain_per_day`
      )
      .run(
        profileId,
        rules.dailyMinutes,
        rules.window?.start ?? null,
        rules.window?.end ?? null,
        rules.quiet?.start ?? null,
        rules.quiet?.end ?? null,
        rules.explainPerDay
      )
    return rules
  }

  // The app is on screen: the time since its last word counts, when it came soon enough.
  beat(profileId: number, now: number) {
    const day = dayOf(now, this.#timeZone())
    const row = this.#db
      .prepare('SELECT last_at FROM youth_time WHERE profile_id = ? AND day = ?')
      .get(profileId, day) as { last_at: number } | undefined
    const gap = row ? now - row.last_at : Infinity
    const credit = gap > 0 && gap <= MAX_GAP_MS ? Math.round(gap / 1000) : 0
    this.#db
      .prepare(
        `INSERT INTO youth_time (profile_id, day, seconds, last_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (profile_id, day) DO UPDATE SET seconds = seconds + excluded.seconds,
           last_at = MAX(last_at, excluded.last_at)`
      )
      .run(profileId, day, credit, now)
  }

  usedSeconds(profileId: number, day: string) {
    const row = this.#db
      .prepare('SELECT seconds FROM youth_time WHERE profile_id = ? AND day = ?')
      .get(profileId, day) as { seconds: number } | undefined
    return row?.seconds ?? 0
  }

  // The last seven days, today last: each one's seconds.
  week(profileId: number, now: number) {
    const timeZone = this.#timeZone()
    const days: string[] = []
    let day = dayOf(now, timeZone)
    for (let count = 0; count < 7; count++) {
      days.unshift(day)
      day = dayOf(Date.parse(dayRange(day, timeZone)!.start) - 1, timeZone)
    }
    return days.map(entry => ({ day: entry, seconds: this.usedSeconds(profileId, entry) }))
  }

  limits(profileId: number, now: number): Limits {
    const timeZone = this.#timeZone()
    const rules = this.rules(profileId)
    const today = dayRange(dayOf(now, timeZone), timeZone)!
    const midnight = Date.parse(today.start)
    const tomorrow = Date.parse(today.end)
    const usedSeconds = this.usedSeconds(profileId, today.day)
    const remainingSeconds = rules.dailyMinutes === null ? null : Math.max(0, rules.dailyMinutes * 60 - usedSeconds)
    const minute = minuteOfDay(now, timeZone)
    const start = rules.window ? minutesOf(rules.window.start) : 0
    const end = rules.window ? minutesOf(rules.window.end) : 24 * 60
    // Tomorrow's first minute it may read.
    const nextOpening = tomorrow + start * MINUTE_MS
    const base = { rules, usedSeconds, remainingSeconds }

    if (minute < start) return { ...base, access: 'before', opensAt: midnight + start * MINUTE_MS, closesAt: null }
    if (minute >= end) return { ...base, access: 'after', opensAt: nextOpening, closesAt: null }
    if (remainingSeconds === 0) return { ...base, access: 'time_up', opensAt: nextOpening, closesAt: null }

    const closings = [
      ...(rules.window ? [midnight + end * MINUTE_MS] : []),
      ...(remainingSeconds === null ? [] : [now + remainingSeconds * 1000])
    ]
    // The time left counts down to whichever comes first, its minutes or the end of its hours: "1 h 50 left" at
    // 18:00 with hours until 18:15 would only frustrate.
    const untilEnd = rules.window ? Math.ceil((midnight + end * MINUTE_MS - now) / 1000) : Infinity
    return {
      ...base,
      remainingSeconds: remainingSeconds === null ? null : Math.min(remainingSeconds, untilEnd),
      access: 'open',
      opensAt: null,
      closesAt: closings.length > 0 ? Math.min(...closings) : null
    }
  }

  // Notifications wait: in its quiet hours, or while it cannot read.
  mayNotify(profileId: number, now: number) {
    const limits = this.limits(profileId, now)
    return limits.access === 'open' && !(limits.rules.quiet && inRange(limits.rules.quiet, now, this.#timeZone()))
  }

  // The sources its parents turned on, out of the household's catalogue and the young readers' one.
  allowedSources(profileId: number) {
    return (
      this.#db.prepare('SELECT source_id FROM youth_sources WHERE profile_id = ?').all(profileId) as {
        source_id: string
      }[]
    ).map(row => row.source_id)
  }

  // Whether its parents ever chose its sources: a new young profile starts with the base ones.
  hasSources(profileId: number) {
    return this.#db.prepare('SELECT 1 FROM youth_sources_set WHERE profile_id = ?').get(profileId) !== undefined
  }

  setAllowedSources(profileId: number, ids: string[]) {
    transaction(this.#db, () => {
      this.#db.prepare('DELETE FROM youth_sources WHERE profile_id = ?').run(profileId)
      const add = this.#db.prepare('INSERT OR IGNORE INTO youth_sources (profile_id, source_id) VALUES (?, ?)')
      for (const id of ids) add.run(profileId, id)
      this.#db.prepare('INSERT OR IGNORE INTO youth_sources_set (profile_id) VALUES (?)').run(profileId)
    })
  }

  // The themes its parents turned off, among those it may see.
  hiddenTopics(profileId: number) {
    return (
      this.#db.prepare('SELECT topic_id FROM youth_topics WHERE profile_id = ?').all(profileId) as {
        topic_id: string
      }[]
    ).map(row => row.topic_id)
  }

  setHiddenTopics(profileId: number, ids: string[]) {
    transaction(this.#db, () => {
      this.#db.prepare('DELETE FROM youth_topics WHERE profile_id = ?').run(profileId)
      const add = this.#db.prepare('INSERT OR IGNORE INTO youth_topics (profile_id, topic_id) VALUES (?, ?)')
      for (const id of ids) add.run(profileId, id)
    })
  }

  addRequest(profileId: number, source: Source, now: number): SourceRequest {
    const { lastInsertRowid } = this.#db
      .prepare('INSERT INTO source_requests (profile_id, source, status, at) VALUES (?, ?, ?, ?)')
      .run(profileId, JSON.stringify(source), 'pending', now)
    return this.request(Number(lastInsertRowid))!
  }

  request(id: number): SourceRequest | null {
    return this.requests({ id })[0] ?? null
  }

  // Pending ones first, newest first; filtered by profile or state.
  requests({ id, profileId, status }: { id?: number; profileId?: number; status?: SourceRequest['status'] } = {}) {
    const rows = this.#db
      .prepare(
        `SELECT id, profile_id, source, status, at FROM source_requests
         WHERE (? IS NULL OR id = ?) AND (? IS NULL OR profile_id = ?) AND (? IS NULL OR status = ?)
         ORDER BY status != 'pending', at DESC, id DESC`
      )
      .all(id ?? null, id ?? null, profileId ?? null, profileId ?? null, status ?? null, status ?? null) as {
      id: number
      profile_id: number
      source: string
      status: SourceRequest['status']
      at: number
    }[]
    return rows.map(row => ({
      id: row.id,
      profileId: row.profile_id,
      source: JSON.parse(row.source) as Source,
      status: row.status,
      at: row.at
    }))
  }

  // Its parents' answers it has not seen yet, the latest first.
  answers(profileId: number): SourceAnswer[] {
    const rows = this.#db
      .prepare(
        `SELECT id, profile_id, source, status, at, decided_at FROM source_requests
         WHERE profile_id = ? AND status != 'pending' AND seen = 0
         ORDER BY decided_at DESC, id DESC`
      )
      .all(profileId) as {
      id: number
      profile_id: number
      source: string
      status: 'accepted' | 'refused'
      at: number
      decided_at: number
    }[]
    return rows.map(row => ({
      id: row.id,
      profileId: row.profile_id,
      source: JSON.parse(row.source) as Source,
      status: row.status,
      at: row.at,
      decidedAt: row.decided_at
    }))
  }

  seeAnswers(profileId: number, ids: number[]) {
    const see = this.#db.prepare(
      "UPDATE source_requests SET seen = 1 WHERE id = ? AND profile_id = ? AND status != 'pending'"
    )
    transaction(this.#db, () => {
      for (const id of ids) see.run(id, profileId)
    })
  }

  decide(id: number, status: 'accepted' | 'refused', now: number) {
    return (
      this.#db
        .prepare("UPDATE source_requests SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending'")
        .run(status, now, id).changes > 0
    )
  }
}
