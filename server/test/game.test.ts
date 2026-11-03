import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { openDatabase } from '../db/database.ts'
import { DAILY_COUNT_LIMITS, GameStore, mondayOf } from '../db/game-store.ts'
import { ProfileStore } from '../db/profile-store.ts'
import { type Reading, UserStore } from '../db/user-store.ts'
import { levelOf, nameIn, parseRules } from '../game/rules.ts'

// Thursday 29 October 2026, 10:00 in Brussels.
const NOW = Date.UTC(2026, 9, 29, 9)
const HOUR = 60 * 60 * 1000
const rules = parseRules(readFileSync('gamification.yml', 'utf8'))

const setup = (gameRules = rules) => {
  const db = openDatabase(':memory:')
  const game = new GameStore(db, gameRules, () => 'Europe/Brussels')
  const user = new UserStore(db, 1)
  let count = 0
  // A reading opened now; tracked ones start skimmed (done: false).
  const open = (topicId: string | null = 'monde', extra: Partial<Reading> = {}) => {
    const id = `article-${++count}`
    user.addReadings(
      [{ id, sourceId: 'alpha', sourceName: 'Alpha', topicId, minutes: 3, at: NOW, kind: 'article', ...extra }],
      NOW
    )
    return id
  }
  return { db, game, user, open }
}

describe('gamification.yml', () => {
  it('reads the rules file of the repository', () => {
    assert.equal(rules.points.articleRead, 10)
    assert.equal(rules.levels.length, 10)
    assert.equal(rules.levels[7]?.name, 'Grande plume')
    assert.equal(rules.badges.length, 10)
  })

  it('turns down levels that do not grow, and unknown badges', () => {
    const text = readFileSync('gamification.yml', 'utf8')
    assert.throws(() => parseRules(text.replace('points: 100 }', 'points: 0 }')), /levels\[1\]\.points/)
    assert.throws(() => parseRules(text.replace('id: sleuth', 'id: detective')), /badges\[7\]\.id/)
    assert.throws(() => parseRules(text.replace('tiers: [50, 250, 1000]', 'tiers: [250, 50, 1000]')), /tiers/)
  })

  it('places points on their level, with the way to the next one', () => {
    assert.deepEqual(levelOf(0, rules.levels), {
      level: 1,
      name: 'Curieux',
      points: 0,
      since: 0,
      previous: null,
      next: { name: 'Lecteur', points: 100 },
      progress: 0
    })
    const reporter = levelOf(1100, rules.levels)
    assert.equal(reporter.name, 'Reporter')
    assert.equal(reporter.progress, 0.5)
    // Its bar counts from where Reporter starts.
    assert.equal(reporter.since, 700)
    assert.deepEqual(reporter.previous, { name: rules.levels[2]?.name })
    const legend = levelOf(99_999, rules.levels)
    assert.equal(legend.name, 'Légende')
    assert.equal(legend.next, null)
    assert.equal(legend.progress, 1)
  })

  it("names grades and badges in the reader's language", () => {
    const named = parseRules(
      readFileSync('gamification.yml', 'utf8').replace('name: Reporter', 'name: { fr: Reporter, en: Newshound }')
    )
    assert.equal(nameIn(named.levels[0]!, 'en'), 'Curious')
    assert.equal(nameIn(named.levels[0]!, 'fr'), 'Curieux')
    assert.equal(nameIn(named.levels[3]!, 'en'), 'Newshound')
    assert.equal(nameIn(rules.levels[3]!, 'en'), 'Reporter')
    assert.equal(nameIn(rules.badges[0]!, 'en'), 'Up early')
    assert.throws(
      () =>
        parseRules(readFileSync('gamification.yml', 'utf8').replace('name: Reporter', 'name: { nl: Verslaggever }')),
      /levels\[3\]\.name\.nl/
    )
  })
})

describe('GameStore', () => {
  it('counts an article once it is read, never while it is only skimmed', () => {
    const { game, user, open } = setup()
    const id = open('monde', { done: false, progress: 0.2 })
    game.recordReads(1, [id], NOW)
    assert.equal(game.summary(1, NOW).points, 0)

    user.updateReading(id, { minutes: 4, progress: 0.85, position: 0.85, done: true }, NOW)
    game.recordReads(1, [id], NOW)
    // 10 for the article, 5 for the first one of the day in Monde.
    assert.equal(game.summary(1, NOW).points, 15)

    // Read again: nothing more.
    game.recordReads(1, [id], NOW + HOUR)
    assert.equal(game.summary(1, NOW).points, 15)
  })

  it('gives a video its own points, and a reading day from the third article', () => {
    const { game, open } = setup()
    game.recordReads(1, [open(null, { kind: 'video' })], NOW)
    assert.equal(game.summary(1, NOW).points, 6)

    const ids = [open('tech'), open('tech'), open('tech')]
    game.recordReads(1, ids, NOW)
    // 6 + 3 × 10 + 5 (first in Tech) + 10 (reading day).
    assert.equal(game.summary(1, NOW).points, 51)
  })

  it('stops at the daily cap, and starts again the next day', () => {
    const { game, open } = setup()
    const ids = Array.from({ length: 20 }, () => open('monde'))
    game.recordReads(1, ids, NOW)
    assert.equal(game.summary(1, NOW).points, rules.points.dailyCap)

    game.recordReads(1, [open('monde')], NOW + 24 * HOUR)
    assert.equal(game.summary(1, NOW + 24 * HOUR).points, rules.points.dailyCap + 10 + 5)
  })

  it('counts a reading sent late (made offline) on its own day, under that day’s cap', () => {
    const { db, game, open } = setup()
    const yesterday = NOW - 24 * HOUR
    const pointsOn = (day: string) =>
      (
        db
          .prepare('SELECT COALESCE(SUM(points), 0) AS points FROM game_events WHERE profile_id = 1 AND day = ?')
          .get(day) as { points: number }
      ).points

    // Twenty articles read yesterday without network, reaching the server today.
    const offline = Array.from({ length: 20 }, () => open('monde'))
    game.recordReads(1, offline, NOW, () => yesterday)
    assert.equal(pointsOn('2026-10-28'), rules.points.dailyCap)
    assert.equal(pointsOn('2026-10-29'), 0)

    // Today keeps its own cap: a reading of today still earns.
    game.recordReads(1, [open('monde')], NOW)
    assert.equal(pointsOn('2026-10-29'), 10 + 5)
    assert.equal(game.summary(1, NOW).points, rules.points.dailyCap + 15)
  })

  it('counts as now a reading time in the future, or more than a week old', () => {
    const { db, game, open } = setup()
    game.recordReads(1, [open('monde')], NOW, () => NOW + HOUR)
    game.recordReads(1, [open('tech')], NOW, () => NOW - 8 * 24 * HOUR)
    const days = db.prepare("SELECT DISTINCT day FROM game_events WHERE kind = 'article_read'").all() as {
      day: string
    }[]
    assert.deepEqual(
      days.map(row => row.day),
      ['2026-10-29']
    )
  })

  it('counts a share with a note once, and each reaction once', () => {
    const { db, game } = setup()
    const julie = new ProfileStore(db).create('Julie', 'monde', NOW)
    assert.ok(julie)
    game.recordShare(1, 'article-1', NOW)
    game.recordShare(1, 'article-1', NOW)
    game.recordReaction(1, 'article-1', julie.id, NOW)
    game.recordReaction(1, 'article-1', julie.id, NOW)
    assert.equal(game.summary(1, NOW).points, rules.points.shareSent + rules.points.reactionReceived)
  })

  it('keeps the week from Monday, in the household time zone', () => {
    assert.equal(mondayOf('2026-10-29'), '2026-10-26')
    assert.equal(mondayOf('2026-10-26'), '2026-10-26')
    assert.equal(mondayOf('2026-11-01'), '2026-10-26')

    const { game, open } = setup()
    game.recordReads(1, [open('monde')], NOW)
    // The next Monday, 00:30 in Brussels: a new week.
    const monday = Date.UTC(2026, 10, 1, 23, 30)
    game.recordReads(1, [open('tech')], monday)
    const summary = game.summary(1, monday)
    assert.equal(summary.points, 30)
    assert.equal(summary.week, 15)
  })

  // Low tiers and a small goal, to reach them in a test.
  const easy = {
    ...rules,
    badges: rules.badges.map(badge => ({ ...badge, tiers: [1, 2, 3] as [number, number, number] })),
    weeklyChallenge: { ...rules.weeklyChallenge, minimum: 3 }
  }

  it('counts the badges from what earned, by hour and by theme', () => {
    const { game, open } = setup(easy)
    // 06:00 in Brussels: before 7.
    const early = Date.UTC(2026, 9, 29, 5)
    game.recordReads(1, [open('monde'), open('monde')], early)
    game.recordReads(1, [open('tech')], NOW)
    const badges = new Map(game.badges(1, ['monde', 'tech']).map(badge => [badge.id, badge]))
    assert.deepEqual(badges.get('early-bird'), {
      id: 'early-bird',
      name: 'Lève-tôt',
      count: 2,
      tier: 2,
      next: 3,
      tiers: [1, 2, 3]
    })
    assert.equal(badges.get('globetrotter')?.count, 2)
    // The theme read least decides.
    assert.equal(badges.get('all-rounder')?.count, 1)
    assert.equal(badges.get('encyclopedia')?.tier, 3)
    assert.equal(badges.get('encyclopedia')?.next, null)
    assert.equal(badges.get('night-owl')?.tier, 0)
  })

  it('takes the server’s word, not the device’s, for what a reading earns', () => {
    const { game, user, open } = setup(easy)
    // The device says Monde and an early reading; the server knows a Tech article published at 9:00.
    const id = open('monde')
    const published = Date.UTC(2026, 9, 29, 8)
    const early = Date.UTC(2026, 9, 29, 5)
    game.recordReads(
      1,
      [id],
      NOW,
      () => early,
      () => ({ kind: 'article', topicId: 'tech', publishedAt: published })
    )
    // An id the server never listed earns nothing.
    game.recordReads(1, [open('monde')], NOW, undefined, () => null)
    const badges = new Map(game.badges(1, ['monde', 'tech']).map(badge => [badge.id, badge]))
    assert.equal(badges.get('encyclopedia')?.count, 1)
    assert.equal(badges.get('globetrotter')?.count, 0)
    assert.equal(badges.get('early-bird')?.count, 0)
    assert.equal(user.getState().readings.length, 2)
  })

  it('stops counting what no one reads in a day: made-up readings and alerts', () => {
    const { game, open } = setup()
    const ids = Array.from({ length: (DAILY_COUNT_LIMITS.article_read ?? 0) + 10 }, () => open('monde'))
    game.recordReads(1, ids, NOW)
    for (let alert = 0; alert < (DAILY_COUNT_LIMITS.alert_opened ?? 0) + 5; alert++) {
      game.recordAlert(1, `alert-${alert}`, NOW)
    }
    const badges = new Map(game.badges(1, ['monde']).map(badge => [badge.id, badge]))
    assert.equal(badges.get('encyclopedia')?.count, DAILY_COUNT_LIMITS.article_read)
    assert.equal(badges.get('sleuth')?.count, DAILY_COUNT_LIMITS.alert_opened)
    // The next day counts again.
    game.recordReads(1, [open('monde')], NOW + 24 * HOUR)
    assert.equal(
      game.badges(1, ['monde']).find(badge => badge.id === 'encyclopedia')?.count,
      (DAILY_COUNT_LIMITS.article_read ?? 0) + 1
    )
  })

  it("gives the level and badges in the reader's language", () => {
    const { game, open } = setup()
    game.recordReads(1, [open('monde')], NOW)
    // 10 points: still the first grade, the second next.
    assert.deepEqual(
      [game.summary(1, NOW).name, game.summary(1, NOW, 'en').name, game.summary(1, NOW, 'en').next?.name],
      ['Curieux', 'Curious', 'Reader']
    )
    assert.equal(game.badges(1, ['monde'], 'en').find(badge => badge.id === 'early-bird')?.name, 'Up early')
  })

  it('wears only a badge the profile earned', () => {
    const { game, open } = setup(easy)
    game.recordReads(1, [open('monde')], NOW)
    assert.equal(game.wear(1, 'night-owl', ['monde'], NOW), false)
    assert.equal(game.wornBadge(1, ['monde']), null)
    assert.equal(game.wear(1, 'globetrotter', ['monde'], NOW), true)
    assert.deepEqual(game.wornBadge(1, ['monde']), { id: 'globetrotter', tier: 1 })
    assert.equal(game.wear(1, null, ['monde'], NOW), true)
    assert.equal(game.wornBadge(1, ['monde']), null)
  })

  it('tells what is new since the sheet was last opened, from the first time it asks', () => {
    const { game, open } = setup(easy)
    game.recordReads(1, [open('monde')], NOW)
    // What was earned before the first look is not news.
    assert.deepEqual(game.news(1, ['monde'], NOW), { level: null, badges: [] })
    game.recordReads(1, [open('monde'), open('monde'), open('monde')], NOW)
    const news = game.news(1, ['monde'], NOW)
    assert.ok(news.level !== null && news.level > 1)
    assert.deepEqual(
      news.badges.find(badge => badge.id === 'globetrotter'),
      { id: 'globetrotter', tier: 3 }
    )
    // Asking again changes nothing; opening the sheet does.
    assert.deepEqual(game.news(1, ['monde'], NOW), news)
    game.markSeen(1, ['monde'], NOW)
    assert.deepEqual(game.news(1, ['monde'], NOW), { level: null, badges: [] })
  })

  it('dates news by the last look, so the same tiers earned again after a reset are new news', () => {
    const { game, open } = setup(easy)
    game.news(1, ['monde'], NOW)
    game.recordReads(1, [open('monde'), open('monde'), open('monde')], NOW)
    assert.equal(game.news(1, ['monde'], NOW).since, NOW)
    game.markSeen(1, ['monde'], NOW + 1000)
    game.recordReads(1, [open('monde'), open('monde'), open('monde'), open('monde')], NOW + 2000)
    assert.equal(game.news(1, ['monde'], NOW + 2000).since, NOW + 1000)
  })

  it('gives every profile the weekly bonus once the household reaches its goal, past the daily cap', () => {
    const { db, game, open } = setup(easy)
    const julie = new ProfileStore(db).create('Julie', 'monde', NOW)
    assert.ok(julie)
    assert.deepEqual(game.challenge(NOW), { goal: 3, read: 0, reached: false })

    const ids = Array.from({ length: 40 }, () => open('monde'))
    game.recordReads(1, ids, NOW)
    assert.deepEqual(game.challenge(NOW), { goal: 3, read: 40, reached: true })
    assert.equal(game.summary(1, NOW).points, rules.points.dailyCap + rules.weeklyChallenge.bonus)
    assert.equal(game.summary(julie.id, NOW).points, rules.weeklyChallenge.bonus)
    assert.equal(game.badges(julie.id, []).find(badge => badge.id === 'team-player')?.count, 1)

    // The next weeks' goal follows what the household read: 40 over 4 weeks, plus 10 %.
    assert.equal(game.challenge(NOW + 7 * 24 * HOUR).goal, 11)
    // Past the 4 weeks looked back, the minimum again.
    assert.equal(game.challenge(NOW + 5 * 7 * 24 * HOUR).goal, 3)
  })

  it('can be turned off for the household', () => {
    const { game } = setup()
    assert.equal(game.enabled(), true)
    game.setEnabled(false)
    assert.equal(game.enabled(), false)
  })
})
