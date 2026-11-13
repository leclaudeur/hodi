import { dayOf, dayRange } from '../news/days.ts'
import type { Database } from './database.ts'
import { DAY_MS } from '../../shared/time.ts'

// The whole server's totals for a list of days, counted from what the database still holds: readings (a year),
// visits (a month), shares, profiles and accounts. Totals only, never what one profile read.

// An account is active when one of its devices opened Hodi in the last 30 days.
export const ACTIVE_DAYS = 30

export interface ServerDay {
  day: string
  // Different profiles that opened Hodi.
  visits: number
  // Articles read for good, videos and episodes watched, and the minutes of both.
  articles: number
  videos: number
  minutes: number
  shares: number
  // Profiles added.
  profiles: number
  // Personal accounts at the end of the day, and those used in the 30 days before it.
  accounts: number
  activeAccounts: number
}

export interface DayCounts {
  totals: ServerDay
  topics: Map<string, number>
  sources: Map<string, { name: string; count: number }>
}

interface Reading {
  kind: string
  minutes: number
  at: number
  done: number | null
  topic: string | null
  source: string
  name: string
}

export const emptyDay = (day: string): ServerDay => ({
  day,
  visits: 0,
  articles: 0,
  videos: 0,
  minutes: 0,
  shares: 0,
  profiles: 0,
  accounts: 0,
  activeAccounts: 0
})

// Every date from `from` to `to`, both included (YYYY-MM-DD).
export const datesBetween = (from: string, to: string) => {
  const dates: string[] = []
  for (let at = Date.parse(`${from}T12:00:00Z`); at <= Date.parse(`${to}T12:00:00Z`); at += DAY_MS)
    dates.push(new Date(at).toISOString().slice(0, 10))
  return dates
}

// Opened and left is not read: as Réglages › Statistiques counts.
const addReadings = (readings: Reading[], at: (when: number) => DayCounts | undefined) => {
  for (const reading of readings) {
    const day = at(reading.at)
    if (!day || reading.done === 0) continue
    day.totals.minutes += reading.minutes
    if (reading.kind === 'article') day.totals.articles += 1
    else day.totals.videos += 1
    if (reading.topic) day.topics.set(reading.topic, (day.topics.get(reading.topic) ?? 0) + 1)
    const source = day.sources.get(reading.source) ?? { name: reading.name, count: 0 }
    source.count += 1
    day.sources.set(reading.source, source)
  }
}

const addAccounts = (db: Database, byDay: Map<string, DayCounts>, endOf: (day: string) => number) => {
  const users = db
    .prepare(
      `SELECT u.created_at AS createdAt, MAX(d.last_seen_at) AS seenAt
       FROM users u LEFT JOIN user_devices d ON d.user_id = u.id GROUP BY u.id`
    )
    .all() as { createdAt: number; seenAt: number | null }[]
  for (const [day, counts] of byDay) {
    const end = endOf(day)
    const made = users.filter(user => user.createdAt < end)
    counts.totals.accounts = made.length
    // A past day only knows each account's last use: used since then counts as used then, an estimate the nightly
    // row fixes from the day it is written.
    counts.totals.activeAccounts = made.filter(
      user => (user.seenAt ?? user.createdAt) >= end - ACTIVE_DAYS * DAY_MS
    ).length
  }
}

// The days' counts, oldest first, in the household's time zone.
export const countDays = (db: Database, dates: string[], timeZone: string, now: number): Map<string, DayCounts> => {
  const byDay = new Map<string, DayCounts>(
    dates.map(day => [day, { totals: emptyDay(day), topics: new Map(), sources: new Map() }])
  )
  if (!dates.length) return byDay
  const bounds = (day: string) => dayRange(day, timeZone)
  const since = Date.parse(bounds(dates[0]!)?.start ?? new Date(now).toISOString())
  const until = Date.parse(bounds(dates.at(-1)!)?.end ?? new Date(now).toISOString())
  const at = (when: number) => byDay.get(dayOf(when, timeZone))

  const readings = db
    .prepare(
      `SELECT kind, minutes, read_at AS at, done, topic_id AS topic, source_id AS source, source_name AS name
       FROM readings WHERE read_at >= ? AND read_at < ?`
    )
    .all(since, until) as unknown as Reading[]
  addReadings(readings, at)

  const visits = db
    .prepare('SELECT day, COUNT(*) AS count FROM profile_visits WHERE day >= ? AND day <= ? GROUP BY day')
    .all(dates[0]!, dates.at(-1)!) as { day: string; count: number }[]
  for (const { day, count } of visits) {
    const entry = byDay.get(day)
    if (entry) entry.totals.visits = count
  }

  const shares = db
    .prepare(
      'SELECT DISTINCT from_profile, article_id, shared_at AS at FROM shares WHERE shared_at >= ? AND shared_at < ?'
    )
    .all(since, until) as { at: number }[]
  for (const share of shares) {
    const day = at(share.at)
    if (day) day.totals.shares += 1
  }

  const profiles = db
    .prepare(
      `SELECT p.created_at AS at FROM profiles p JOIN accounts a ON a.id = p.account_id
       WHERE a.set_up_at IS NOT NULL AND p.created_at >= ? AND p.created_at < ?`
    )
    .all(since, until) as { at: number }[]
  for (const profile of profiles) {
    const day = at(profile.at)
    if (day) day.totals.profiles += 1
  }

  addAccounts(db, byDay, day => Math.min(now, Date.parse(bounds(day)?.end ?? new Date(now).toISOString())))
  return byDay
}
