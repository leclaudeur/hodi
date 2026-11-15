import { dayOf } from '../news/days.ts'
import type { Database } from './database.ts'
import { type DayCounts, type ServerDay, countDays, datesBetween, emptyDay } from './server-day-counts.ts'
import { DAY_MS } from '../../shared/time.ts'

export type { ServerDay } from './server-day-counts.ts'

// Serveur › Vue d'ensemble: the whole server's numbers, every household and profile together. Only totals leave
// here, never what one profile read.

// The different profiles that opened Hodi on a day are kept a month, for the 30 days' chart.
const VISITS_KEPT_DAYS = 31
// Readings are kept a little over a year: the first nightly rows are filled from them.
const READINGS_DAYS = 400

export interface ServerOverview {
  households: number
  profiles: { adults: number; young: number }
  // The first day with numbers: « Tout » starts there.
  since: string
  days: ServerDay[]
  // The same number of days just before, day by day: the cards' « ↑ 12 % » and the chart's dashed line. Empty
  // when the server has no numbers that far back.
  previous: ServerDay[]
  topics: { id: string; count: number }[]
  sources: { id: string; name: string; count: number }[]
}

// The last `days` days up to today (0: « Tout »), or two dates.
export type Period = { days: number } | { from: string; to: string }

const byCount = <T extends { count: number }>(a: T, b: T) => b.count - a.count

export class ServerStatsStore {
  readonly #db: Database
  readonly #timeZone: () => string
  // The visits already written today, so that a request does not write each time.
  #seen = new Set<string>()
  #prunedOn = ''

  constructor(db: Database, timeZone: () => string) {
    this.#db = db
    this.#timeZone = timeZone
  }

  // A profile opened Hodi: once a day, in the household's time zone. The first visit of a day also writes the
  // nightly rows of the days before.
  recordVisit(profileId: number, now: number) {
    const day = dayOf(now, this.#timeZone())
    const key = `${day}:${profileId}`
    if (this.#seen.has(key)) return
    if (this.#prunedOn !== day) {
      this.#seen = new Set()
      this.#prunedOn = day
      const oldest = dayOf(now - VISITS_KEPT_DAYS * DAY_MS, this.#timeZone())
      this.#db.prepare('DELETE FROM profile_visits WHERE day < ?').run(oldest)
      this.writeFinishedDays(now)
    }
    this.#seen.add(key)
    this.#db.prepare('INSERT OR IGNORE INTO profile_visits (day, profile_id) VALUES (?, ?)').run(day, profileId)
  }

  // One row per finished day not written yet, from the last one written (the first time: from the oldest reading,
  // a year at most) to yesterday. Written once, it stays when the readings and visits it came from are gone.
  writeFinishedDays(now: number) {
    const timeZone = this.#timeZone()
    const yesterday = dayOf(now - DAY_MS, timeZone)
    const { last } = this.#db.prepare('SELECT MAX(day) AS last FROM server_days').get() as { last: string | null }
    const first = last ? datesBetween(last, yesterday)[1] : this.#firstDay(now)
    if (!first || first > yesterday) return
    const counts = countDays(this.#db, datesBetween(first, yesterday), timeZone, now)
    const day = this.#db.prepare(
      `INSERT OR REPLACE INTO server_days
       (day, visits, articles, videos, minutes, shares, profiles, accounts, active_accounts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const read = this.#db.prepare(
      'INSERT OR REPLACE INTO server_day_reads (day, kind, id, name, count) VALUES (?, ?, ?, ?, ?)'
    )
    this.#db.exec('BEGIN')
    try {
      for (const { totals: t, topics, sources } of counts.values()) {
        day.run(t.day, t.visits, t.articles, t.videos, t.minutes, t.shares, t.profiles, t.accounts, t.activeAccounts)
        for (const [id, count] of topics) read.run(t.day, 'topic', id, '', count)
        for (const [id, { name, count }] of sources) read.run(t.day, 'source', id, name, count)
      }
      this.#db.exec('COMMIT')
    } catch (error) {
      this.#db.exec('ROLLBACK')
      throw error
    }
  }

  // The oldest day the readings, the first profile or the first account still tell about.
  #firstDay(now: number) {
    const { at } = this.#db
      .prepare(
        `SELECT MIN(at) AS at FROM (
           SELECT MIN(read_at) AS at FROM readings UNION ALL SELECT MIN(created_at) FROM users
           UNION ALL SELECT MIN(created_at) FROM profiles)`
      )
      .get() as { at: number | null }
    return dayOf(Math.max(at ?? now, now - READINGS_DAYS * DAY_MS), this.#timeZone())
  }

  // The days from `from` to `to`: the written ones from their rows, today and any day not written yet counted live.
  #days(from: string, to: string, now: number) {
    const dates = datesBetween(from, to)
    const rows = this.#db
      .prepare(
        `SELECT day, visits, articles, videos, minutes, shares, profiles, accounts, active_accounts AS activeAccounts
         FROM server_days WHERE day >= ? AND day <= ?`
      )
      .all(from, to) as unknown as ServerDay[]
    const written = new Map(rows.map(row => [row.day, row]))
    const missing = dates.filter(day => !written.has(day))
    const live: Map<string, DayCounts> = missing.length
      ? countDays(this.#db, missing, this.#timeZone(), now)
      : new Map()
    const days = dates.map(day => written.get(day) ?? live.get(day)?.totals ?? emptyDay(day))
    return { days, written: [...written.keys()], live }
  }

  // What each theme and source was read, over the period: the rows' counts and the live days'.
  #reads(written: string[], live: Map<string, DayCounts>) {
    const topics = new Map<string, number>()
    const sources = new Map<string, { id: string; name: string; count: number }>()
    const addSource = (id: string, name: string, count: number) => {
      const source = sources.get(id) ?? { id, name, count: 0 }
      source.count += count
      sources.set(id, source)
    }
    if (written.length) {
      const rows = this.#db
        .prepare(
          'SELECT kind, id, name, SUM(count) AS count FROM server_day_reads WHERE day >= ? AND day <= ? GROUP BY kind, id'
        )
        .all(written[0]!, written.at(-1)!) as { kind: string; id: string; name: string; count: number }[]
      for (const row of rows)
        if (row.kind === 'topic') topics.set(row.id, row.count)
        else addSource(row.id, row.name, row.count)
    }
    for (const day of live.values()) {
      for (const [id, count] of day.topics) topics.set(id, (topics.get(id) ?? 0) + count)
      for (const [id, { name, count }] of day.sources) addSource(id, name, count)
    }
    return {
      topics: [...topics].map(([id, count]) => ({ id, count })).sort(byCount),
      sources: [...sources.values()].sort(byCount)
    }
  }

  // The period's days, at most up to today.
  overview(period: Period, now: number): ServerOverview {
    this.writeFinishedDays(now)
    const today = dayOf(now, this.#timeZone())
    const { first } = this.#db.prepare('SELECT MIN(day) AS first FROM server_days').get() as { first: string | null }
    const since = first ?? today
    const to = 'to' in period && period.to < today ? period.to : today
    // A chosen start before the server's first day starts on that day: nothing was counted before it, and a date
    // such as 0001-01-01 would otherwise make hundreds of thousands of empty days.
    const from =
      'from' in period
        ? [period.from, since].sort().at(-1)!
        : period.days
          ? dayOf(Date.parse(`${today}T12:00:00Z`) - (period.days - 1) * DAY_MS, 'UTC')
          : since
    const { days, written, live } = this.#days(from, to, now)
    const before = datesBetween(dayOf(Date.parse(`${from}T12:00:00Z`) - days.length * DAY_MS, 'UTC'), from).slice(0, -1)
    const previous = before.length && before.at(-1)! >= since ? this.#days(before[0]!, before.at(-1)!, now).days : []

    const kinds = this.#db
      .prepare('SELECT p.kind FROM profiles p JOIN accounts a ON a.id = p.account_id WHERE a.set_up_at IS NOT NULL')
      .all() as { kind: string }[]
    const { count: households } = this.#db
      .prepare('SELECT COUNT(*) AS count FROM accounts WHERE set_up_at IS NOT NULL')
      .get() as { count: number }
    const adults = kinds.filter(profile => profile.kind === 'adult').length
    return {
      households,
      profiles: { adults, young: kinds.length - adults },
      since,
      days,
      previous,
      ...this.#reads(written, live)
    }
  }
}
