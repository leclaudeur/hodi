import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import type { Language } from '../../shared/i18n.ts'
import { type Labels, labelIn, parseLabels } from '../labels.ts'

// gamification.yml: the household game's numbers, read once at start.

export const BADGE_IDS = [
  'early-bird',
  'night-owl',
  'faithful',
  'globetrotter',
  'all-rounder',
  'postman',
  'crowd-pleaser',
  'sleuth',
  'encyclopedia',
  'team-player'
] as const
export type BadgeId = (typeof BADGE_IDS)[number]

export interface GameRules {
  points: {
    articleRead: number
    videoWatched: number
    firstOfThemeToday: number
    shareSent: number
    reactionReceived: number
    readingDay: number
    readingDayArticles: number
    dailyCap: number
  }
  levels: (Named & { points: number })[]
  badges: (Named & { id: BadgeId; tiers: [number, number, number] })[]
  weeklyChallenge: { lookbackWeeks: number; raise: number; minimum: number; bonus: number }
}

// A grade or badge name, the same in every language or one per language ({ fr: Lecteur, en: Reader }).
export interface Named {
  name: string
  names?: Labels
}

export const nameIn = (named: Named, language: Language) =>
  labelIn({ label: named.name, labels: named.names }, language)

const nameOf = (value: unknown, where: string): Named => {
  const { label, labels } = parseLabels(value, where, fail)
  return labels ? { name: label, names: labels } : { name: label }
}

const fail = (where: string, message: string): never => {
  throw new Error(`gamification: ${where}: ${message}`)
}

const asRecord = (value: unknown, where: string) =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail(where, 'expected a mapping')

const asList = (value: unknown, where: string) =>
  Array.isArray(value) && value.length > 0 ? (value as unknown[]) : fail(where, 'expected a list')

const asString = (value: unknown, where: string) =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : fail(where, 'expected a non-empty string')

// A whole number of 0 or more, or a share (raise) when whole is false.
const asNumber = (value: unknown, where: string, whole = true) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && (!whole || Number.isInteger(value))
    ? value
    : fail(where, whole ? 'expected a whole number, 0 or more' : 'expected a number, 0 or more')

export const parseRules = (yamlText: string): GameRules => {
  const root = asRecord(parse(yamlText), 'root')

  const points = asRecord(root.points, 'points')
  const point = (key: string) => asNumber(points[key], `points.${key}`)

  const levels = asList(root.levels, 'levels').map((value, index) => {
    const level = asRecord(value, `levels[${index}]`)
    return {
      ...nameOf(level.name, `levels[${index}].name`),
      points: asNumber(level.points, `levels[${index}].points`)
    }
  })
  if (levels[0]?.points !== 0) fail('levels[0].points', 'the first level starts at 0')
  levels.forEach((level, index) => {
    if (index > 0 && level.points <= (levels[index - 1]?.points ?? 0)) {
      fail(`levels[${index}].points`, 'each level needs more points than the one before')
    }
  })

  const seen = new Set<string>()
  const badges = asList(root.badges, 'badges').map((value, index) => {
    const where = `badges[${index}]`
    const badge = asRecord(value, where)
    const id = asString(badge.id, `${where}.id`)
    if (!(BADGE_IDS as readonly string[]).includes(id)) fail(`${where}.id`, `expected one of ${BADGE_IDS.join(', ')}`)
    if (seen.has(id)) fail(`${where}.id`, `${id} is listed twice`)
    seen.add(id)
    const tiers = asList(badge.tiers, `${where}.tiers`).map((tier, at) => asNumber(tier, `${where}.tiers[${at}]`))
    const [bronze = 0, silver = 0, gold = 0] = tiers
    if (tiers.length !== 3 || !(bronze > 0 && silver > bronze && gold > silver)) {
      fail(`${where}.tiers`, 'expected three growing numbers: bronze, silver, gold')
    }
    return {
      id: id as BadgeId,
      ...nameOf(badge.name, `${where}.name`),
      tiers: [bronze, silver, gold] as [number, number, number]
    }
  })

  const challenge = asRecord(root.weekly_challenge, 'weekly_challenge')

  return {
    points: {
      articleRead: point('article_read'),
      videoWatched: point('video_watched'),
      firstOfThemeToday: point('first_of_theme_today'),
      shareSent: point('share_sent'),
      reactionReceived: point('reaction_received'),
      readingDay: point('reading_day'),
      readingDayArticles: point('reading_day_articles'),
      dailyCap: point('daily_cap')
    },
    levels,
    badges,
    weeklyChallenge: {
      lookbackWeeks: Math.max(1, asNumber(challenge.lookback_weeks, 'weekly_challenge.lookback_weeks')),
      raise: asNumber(challenge.raise, 'weekly_challenge.raise', false),
      minimum: asNumber(challenge.minimum, 'weekly_challenge.minimum'),
      bonus: asNumber(challenge.bonus, 'weekly_challenge.bonus')
    }
  }
}

export const loadRules = (file: string) => parseRules(readFileSync(file, 'utf8'))

export interface LevelProgress {
  // From 1.
  level: number
  name: string
  points: number
  // Where this level starts: its bar counts from there.
  since: number
  // The level before, or null at the first: a new grade's celebration fills the bar from it.
  previous: { name: string } | null
  // The next level, or null at the last one.
  next: { name: string; points: number } | null
  // 0 to 1 of the way from this level to the next (1 at the last).
  progress: number
}

// levels: named in the reader's language.
export const levelOf = (points: number, levels: { name: string; points: number }[]): LevelProgress => {
  const index = Math.max(
    0,
    levels.findLastIndex(level => points >= level.points)
  )
  const current = levels[index] ?? { name: '', points: 0 }
  const next = levels[index + 1] ?? null
  return {
    level: index + 1,
    name: current.name,
    points,
    since: current.points,
    previous: index > 0 ? { name: levels[index - 1]?.name ?? '' } : null,
    next: next && { name: next.name, points: next.points },
    progress: next ? (points - current.points) / (next.points - current.points) : 1
  }
}
