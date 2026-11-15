import { dayOf } from '../news/days.ts'
import { currentHouseholdId } from './household-scope.ts'
import type { Language } from '../../shared/i18n.ts'
import { type BadgeId, type GameRules, type LevelProgress, levelOf, nameIn } from '../game/rules.ts'
import { type Database, transaction } from './database.ts'
import { badgeCounts } from './game-badges.ts'
import { DAY_MS } from '../../shared/time.ts'

// The household game's points: one row per thing that earned them, kept for good (the readings themselves are
// pruned after a year). A thing earns once (its kind and ref).

export type GameEventKind =
  | 'article_read'
  | 'video_watched'
  | 'first_of_theme'
  | 'reading_day'
  | 'share_sent'
  | 'reaction_received'
  // A notification of a followed subject opened: no points, it counts for its badge.
  | 'alert_opened'
  // The household reached its weekly challenge: the bonus.
  | 'challenge'

export interface GameSummary extends LevelProgress {
  // Earned since Monday, in the household's time zone.
  week: number
}

interface Earning {
  kind: GameEventKind
  ref: string
  points: number
  topicId?: string | null
}

export interface BadgeProgress {
  id: BadgeId
  name: string
  count: number
  // 0: not earned yet, then bronze, silver, gold.
  tier: 0 | 1 | 2 | 3
  // What the next tier needs, or null once gold.
  next: number | null
  // What each tier needs: bronze, silver, gold.
  tiers: number[]
}

// What a profile has earned since it last opened its sheet: a new level, new badge tiers. Celebrated once there.
export interface GameNews {
  // The level reached, or null when it did not change.
  level: number | null
  badges: { id: BadgeId; tier: BadgeProgress['tier'] }[]
  // When the sheet was last opened (or the record reset), only with news: the same tiers earned again after a test
  // reset are new news, which a device that celebrated them before celebrates again.
  since?: number
}

interface Seen {
  level: number
  badges: Partial<Record<BadgeId, number>>
}

export interface WeeklyChallenge {
  // Articles to read together from Monday to Sunday, and those read so far.
  goal: number
  read: number
  reached: boolean
}

// How late a reading made offline may reach the server and still earn on its own day.
const LATE_SYNC_MS = 7 * DAY_MS
// What one profile counts in a day, at most: far more than anyone reads, so only a script sending made-up readings or
// alerts meets it (120 articles is six hours at three minutes each). Past it, nothing counts, neither for points nor
// for the badges.
export const DAILY_COUNT_LIMITS: Partial<Record<GameEventKind, number>> = {
  article_read: 120,
  video_watched: 120,
  alert_opened: 40,
  share_sent: 40,
  reaction_received: 40
}

// What the server itself knows of an article or a video: the client's word is not taken for its kind, its theme or
// a reading time before it was published.
export interface ReadFacts {
  kind: 'article' | 'video'
  topicId: string | null
  publishedAt: number | null
}

const daysBefore = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10)

// YYYY-MM-DD of the Monday of that day's week.
export const mondayOf = (day: string) => {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
  return date.toISOString().slice(0, 10)
}

const hourOf = (at: number, timeZone: string) =>
  Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(at))

export class GameStore {
  readonly #db: Database
  readonly #rules: GameRules
  readonly #timeZone: () => string

  constructor(db: Database, rules: GameRules, timeZone: () => string) {
    this.#db = db
    this.#rules = rules
    this.#timeZone = timeZone
  }

  get rules() {
    return this.#rules
  }

  // Whether it was new: what already earned does not earn again.
  #earn(profileId: number, earning: Earning, now: number): boolean {
    const timeZone = this.#timeZone()
    const day = dayOf(now, timeZone)
    const limit = DAILY_COUNT_LIMITS[earning.kind]
    if (limit !== undefined) {
      const { counted } = this.#db
        .prepare('SELECT COUNT(*) AS counted FROM game_events WHERE profile_id = ? AND day = ? AND kind = ?')
        .get(profileId, day, earning.kind) as { counted: number }
      if (counted >= limit) return false
    }
    const result = this.#db
      .prepare(
        `INSERT OR IGNORE INTO game_events (profile_id, kind, ref, points, at, day, hour, topic_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        profileId,
        earning.kind,
        earning.ref,
        earning.points,
        now,
        day,
        hourOf(now, timeZone),
        earning.topicId ?? null
      )
    return result.changes > 0
  }

  // Articles and videos whose reading changed: each earns once it counts as read (opened before the reading
  // was tracked, or read far enough), never when only skimmed. readAt: when the device says it happened, for a
  // reading made offline and sent later. It then earns on that day, within that day's counts; a time in the future or
  // from too long ago counts as now.
  // facts: what the server knows of each one; an id it does not know earns nothing.
  recordReads(
    profileId: number,
    ids: string[],
    now: number,
    readAt: (id: string) => number | undefined = () => undefined,
    facts?: (id: string) => ReadFacts | null
  ) {
    const reading = this.#db.prepare(
      'SELECT kind, topic_id, done FROM readings WHERE profile_id = ? AND article_id = ?'
    )
    transaction(this.#db, () => {
      for (const id of ids) {
        const known = facts ? facts(id) : undefined
        if (known === null) continue
        const at = readAt(id)
        const sent = at !== undefined && at <= now && at > now - LATE_SYNC_MS ? at : now
        // Never read before it was published: an early-bird reading cannot be made up from yesterday's article.
        const when = known?.publishedAt != null ? Math.min(now, Math.max(sent, known.publishedAt)) : sent
        const stored = reading.get(profileId, id) as
          { kind: string; topic_id: string | null; done: number | null } | undefined
        if (!stored || stored.done === 0) continue
        const row = known ? { ...stored, kind: known.kind, topic_id: known.topicId } : stored
        this.#earnRead(profileId, id, row, when)
      }
    })
  }

  // One article or video counted as read: its points, and the bonuses it unlocks that day.
  #earnRead(profileId: number, id: string, row: { kind: string; topic_id: string | null }, when: number) {
    const { points } = this.#rules
    if (row.kind !== 'article') {
      this.#earn(profileId, { kind: 'video_watched', ref: id, points: points.videoWatched }, when)
      return
    }
    if (
      !this.#earn(profileId, { kind: 'article_read', ref: id, points: points.articleRead, topicId: row.topic_id }, when)
    ) {
      return
    }
    const day = dayOf(when, this.#timeZone())
    if (row.topic_id) {
      this.#earn(
        profileId,
        {
          kind: 'first_of_theme',
          ref: `${day}:${row.topic_id}`,
          points: points.firstOfThemeToday,
          topicId: row.topic_id
        },
        when
      )
    }
    const { read } = this.#db
      .prepare("SELECT COUNT(*) AS read FROM game_events WHERE profile_id = ? AND day = ? AND kind = 'article_read'")
      .get(profileId, day) as { read: number }
    if (read >= points.readingDayArticles) {
      this.#earn(profileId, { kind: 'reading_day', ref: day, points: points.readingDay }, when)
    }
    this.#checkChallenge(when)
  }

  // The week's goal reached: every profile gets the bonus, once a week.
  #checkChallenge(now: number) {
    const challenge = this.challenge(now)
    if (!challenge.reached) return
    const monday = mondayOf(dayOf(now, this.#timeZone()))
    const profiles = this.#db.prepare('SELECT id FROM profiles WHERE account_id = ?').all(currentHouseholdId()) as {
      id: number
    }[]
    for (const { id } of profiles) {
      this.#earn(id, { kind: 'challenge', ref: monday, points: this.#rules.weeklyChallenge.bonus }, now)
    }
  }

  // The household's articles read per week over the last weeks, raised; a new household gets the minimum.
  challenge(now: number): WeeklyChallenge {
    const { lookbackWeeks, raise, minimum } = this.#rules.weeklyChallenge
    const monday = mondayOf(dayOf(now, this.#timeZone()))
    const count = (from: string, to: string) =>
      (
        this.#db
          .prepare("SELECT COUNT(*) AS read FROM game_events WHERE kind = 'article_read' AND day >= ? AND day < ?")
          .get(from, to) as { read: number }
      ).read
    const before = count(daysBefore(monday, 7 * lookbackWeeks), monday)
    const goal = Math.max(minimum, Math.round((before / lookbackWeeks) * (1 + raise)))
    const read = count(monday, daysBefore(monday, -7))
    return { goal, read, reached: read >= goal }
  }

  // A notification of a followed subject, opened.
  recordAlert(profileId: number, articleId: string, now: number) {
    this.#earn(profileId, { kind: 'alert_opened', ref: articleId, points: 0 }, now)
  }

  // An article sent with a note earns once, whoever it went to.
  recordShare(profileId: number, articleId: string, now: number) {
    this.#earn(profileId, { kind: 'share_sent', ref: articleId, points: this.#rules.points.shareSent }, now)
  }

  // A reaction to what profileId sent; changing it does not earn again.
  recordReaction(profileId: number, articleId: string, from: number, now: number) {
    this.#earn(
      profileId,
      { kind: 'reaction_received', ref: `${articleId}:${from}`, points: this.#rules.points.reactionReceived },
      now
    )
  }

  // topicIds: the themes the all-rounder badge asks for, each of them. Named in the reader's language.
  badges(profileId: number, topicIds: string[], language: Language = 'fr'): BadgeProgress[] {
    const counts = badgeCounts(this.#db, profileId, topicIds)
    return this.#rules.badges.map(badge => {
      const count = counts[badge.id]
      const tier = badge.tiers.filter(needed => count >= needed).length as BadgeProgress['tier']
      return {
        id: badge.id,
        name: nameIn(badge, language),
        count,
        tier,
        next: (badge.tiers as number[])[tier] ?? null,
        tiers: [...badge.tiers]
      }
    })
  }

  // The badge shown on this profile's avatar and its tier, while it still holds it (the rules may have changed).
  wornBadge(profileId: number, topicIds: string[]): { id: BadgeId; tier: BadgeProgress['tier'] } | null {
    const row = this.#db
      .prepare("SELECT value FROM profile_settings WHERE profile_id = ? AND key = 'game_badge'")
      .get(profileId) as { value: string } | undefined
    if (!row) return null
    const badge = this.badges(profileId, topicIds).find(candidate => candidate.id === row.value && candidate.tier > 0)
    return badge ? { id: badge.id, tier: badge.tier } : null
  }

  // false: not a badge this profile has earned.
  wear(profileId: number, id: string | null, topicIds: string[], now: number): boolean {
    if (id === null) {
      this.#db.prepare("DELETE FROM profile_settings WHERE profile_id = ? AND key = 'game_badge'").run(profileId)
      return true
    }
    if (!this.badges(profileId, topicIds).some(badge => badge.id === id && badge.tier > 0)) return false
    this.#db
      .prepare(
        `INSERT INTO profile_settings (profile_id, key, value, updated_at) VALUES (?, 'game_badge', ?, ?)
         ON CONFLICT (profile_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(profileId, id, now)
    return true
  }

  // Since the profile's sheet was last opened. A profile that never had a record starts from what it has: what it
  // earned before this existed is not celebrated.
  news(profileId: number, topicIds: string[], now: number): GameNews {
    const row = this.#db
      .prepare("SELECT value, updated_at FROM profile_settings WHERE profile_id = ? AND key = 'game_seen'")
      .get(profileId) as { value: string; updated_at: number } | undefined
    const badges = this.badges(profileId, topicIds)
    const { level } = this.summary(profileId, now)
    if (!row) {
      this.#saveSeen(profileId, level, badges, now)
      return { level: null, badges: [] }
    }
    const seen = JSON.parse(row.value) as Seen
    const news: GameNews = {
      level: level > seen.level ? level : null,
      badges: badges
        .filter(badge => badge.tier > (seen.badges[badge.id] ?? 0))
        .map(badge => ({ id: badge.id, tier: badge.tier }))
    }
    return news.level === null && news.badges.length === 0 ? news : { ...news, since: row.updated_at }
  }

  // The sheet was opened: what the profile has now is celebrated.
  markSeen(profileId: number, topicIds: string[], now: number) {
    this.#saveSeen(profileId, this.summary(profileId, now).level, this.badges(profileId, topicIds), now)
  }

  #saveSeen(profileId: number, level: number, badges: BadgeProgress[], now: number) {
    const seen: Seen = { level, badges: Object.fromEntries(badges.map(badge => [badge.id, badge.tier])) }
    this.#db
      .prepare(
        `INSERT INTO profile_settings (profile_id, key, value, updated_at) VALUES (?, 'game_seen', ?, ?)
         ON CONFLICT (profile_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(profileId, JSON.stringify(seen), now)
  }

  // false: the admin turned the game off for the household; nothing shows, points still count.
  enabled(): boolean {
    const row = this.#db.prepare('SELECT game FROM accounts WHERE id = ?').get(currentHouseholdId()) as
      { game: number } | undefined
    return row?.game !== 0
  }

  setEnabled(enabled: boolean) {
    this.#db.prepare('UPDATE accounts SET game = ? WHERE id = ?').run(enabled ? 1 : 0, currentHouseholdId())
  }

  // The grades named in the reader's language.
  summary(profileId: number, now: number, language: Language = 'fr'): GameSummary {
    const monday = mondayOf(dayOf(now, this.#timeZone()))
    const row = this.#db
      .prepare(
        `SELECT COALESCE(SUM(points), 0) AS total, COALESCE(SUM(CASE WHEN day >= ? THEN points END), 0) AS week
         FROM game_events WHERE profile_id = ?`
      )
      .get(monday, profileId) as { total: number; week: number }
    const levels = this.#rules.levels.map(level => ({ name: nameIn(level, language), points: level.points }))
    return { ...levelOf(row.total, levels), week: row.week }
  }
}
