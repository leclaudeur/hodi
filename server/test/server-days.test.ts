import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { openDatabase } from '../db/database.ts'
import { ServerStatsStore } from '../db/server-stats-store.ts'

const DAY = 24 * 60 * 60 * 1000
// Friday 6 November 2026, 15:00 in Brussels.
const NOW = Date.UTC(2026, 10, 6, 14, 0)

const withReadings = () => {
  const db = openDatabase(':memory:')
  const insert = db.prepare(
    `INSERT INTO readings (profile_id, article_id, source_id, source_name, topic_id, minutes, read_at, kind, done)
     VALUES (1, ?, ?, ?, ?, ?, ?, 'article', 1)`
  )
  // One article a day for six themes and sources, ten days long.
  const topics = ['belgium', 'world', 'tech', 'science', 'sport', 'ai']
  for (let day = 0; day < 10; day += 1)
    insert.run(`a${day}`, `s${day % 6}`, `Source ${day % 6}`, topics[day % 6], 3, NOW - day * DAY)
  return db
}

describe('server days', () => {
  it('writes one row per finished day, kept once the readings are gone', () => {
    const db = withReadings()
    const stats = new ServerStatsStore(db, () => 'Europe/Brussels')
    stats.writeFinishedDays(NOW)
    const rows = db.prepare('SELECT day, articles FROM server_days ORDER BY day').all() as {
      day: string
      articles: number
    }[]
    // From the oldest reading to yesterday: today is still counted live.
    assert.equal(rows[0]?.day, '2026-10-28')
    assert.equal(rows.at(-1)?.day, '2026-11-05')
    assert.ok(rows.every(row => row.articles === 1))

    db.prepare('DELETE FROM readings WHERE read_at < ?').run(NOW - DAY / 2)
    const all = stats.overview({ days: 0 }, NOW)
    assert.equal(all.since, '2026-10-28')
    assert.equal(all.days.length, 10)
    assert.equal(
      all.days.reduce((total, day) => total + day.articles, 0),
      10
    )
  })

  it('writes each day once, then only the new ones', () => {
    const db = withReadings()
    const stats = new ServerStatsStore(db, () => 'UTC')
    stats.writeFinishedDays(NOW)
    db.prepare('UPDATE server_days SET articles = 99 WHERE day = ?').run('2026-11-05')
    stats.writeFinishedDays(NOW + 2 * DAY)
    const rows = db.prepare('SELECT day, articles FROM server_days ORDER BY day').all() as {
      day: string
      articles: number
    }[]
    assert.equal(rows.find(row => row.day === '2026-11-05')?.articles, 99)
    assert.deepEqual(
      rows.slice(-2).map(row => row.day),
      ['2026-11-06', '2026-11-07']
    )
  })

  it('takes any two dates, adds up the days before, and lists every theme and source', () => {
    const db = withReadings()
    const stats = new ServerStatsStore(db, () => 'UTC')
    const chosen = stats.overview({ from: '2026-11-02', to: '2026-11-06' }, NOW)
    assert.deepEqual(
      chosen.days.map(day => day.day),
      ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']
    )
    // The five days before: 28 October to 1 November, one article each.
    assert.equal(chosen.previous.length, 5)
    assert.equal(
      chosen.previous.reduce((total, day) => total + day.articles, 0),
      5
    )
    assert.equal(chosen.topics.length, 5)

    const week = stats.overview({ days: 7 }, NOW)
    assert.equal(week.topics.length, 6)
    assert.equal(week.sources.length, 6)
    // A date after today stops at today.
    assert.equal(stats.overview({ from: '2026-11-05', to: '2026-12-01' }, NOW).days.length, 2)
  })

  it("starts a chosen period no earlier than the server's first day", () => {
    const stats = new ServerStatsStore(withReadings(), () => 'UTC')
    const all = stats.overview({ days: 0 }, NOW)
    const far = stats.overview({ from: '0001-01-01', to: '2026-11-06' }, NOW)
    assert.equal(far.days[0]?.day, '2026-10-28')
    assert.deepEqual(far.days, all.days)
    assert.deepEqual(far.previous, [])
  })

  it('counts the accounts made by each day and those used in the 30 days before it', () => {
    const db = openDatabase(':memory:')
    const user = db.prepare(
      "INSERT INTO users (email, password_hash, password_changed_at, created_at) VALUES (?, 'x', 0, ?)"
    )
    const device = db.prepare('INSERT INTO user_devices (user_id, created_at, last_seen_at) VALUES (?, ?, ?)')
    const old = Number(user.run('old@example.test', NOW - 90 * DAY).lastInsertRowid)
    device.run(old, NOW - 90 * DAY, NOW - 60 * DAY)
    const recent = Number(user.run('new@example.test', NOW - 3 * DAY).lastInsertRowid)
    device.run(recent, NOW - 3 * DAY, NOW - 60_000)
    const stats = new ServerStatsStore(db, () => 'UTC')
    const week = stats.overview({ days: 7 }, NOW)
    assert.deepEqual(
      week.days.map(day => day.accounts),
      [1, 1, 1, 2, 2, 2, 2]
    )
    assert.equal(week.days.at(-1)?.activeAccounts, 1)
  })
})
