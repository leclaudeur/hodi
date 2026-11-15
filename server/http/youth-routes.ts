import express from 'express'
import { type Profile, type ProfileStore, isYoung } from '../db/profile-store.ts'
import type { UserStore } from '../db/user-store.ts'
import {
  MAX_EXPLAIN_PER_DAY,
  type TimeRange,
  type YouthRules,
  type YouthStore,
  isDailyMinutes,
  isTime,
  minutesOf
} from '../db/youth-store.ts'
import type { YouthSources } from '../news/youth-sources.ts'
import { isAdminOf, isParentOf, kindOf, profileIdOf } from './profile-routes.ts'
import { WEEK_MS } from '../../shared/time.ts'

const MAX_IDS = 300
// A teen waits for its parents' answers past this many: a short list for them, and no flood.
export const MAX_PENDING_REQUESTS = 3

export const idList = (value: unknown) =>
  Array.isArray(value) &&
  value.length <= MAX_IDS &&
  value.every(id => typeof id === 'string' && id.length > 0 && id.length <= 100)
    ? [...new Set(value as string[])]
    : null

// What a young profile may not open once its time is up or outside its hours: everything that lists or shows
// articles and videos. Its profile, its settings and "Qui lit ?" still answer, for the À demain screen.
const CLOSED_PATHS = [
  '/feed',
  '/topics',
  '/front-page',
  '/articles',
  '/search',
  '/listen',
  '/trends',
  '/daily-summary',
  '/me/history',
  '/me/resume',
  '/me/shares'
]

// undefined: not sent; null: none; false: wrong.
const rangeOf = (value: unknown, sameDay: boolean): TimeRange | null | undefined | false => {
  if (value === undefined || value === null) return value
  const { start, end } = value as { start?: unknown; end?: unknown }
  if (!isTime(start) || !isTime(end) || start === end) return false
  return sameDay && minutesOf(start) > minutesOf(end) ? false : { start, end }
}

// The rules as sent, or null when anything is wrong.
export const parseRules = (body: unknown): Partial<YouthRules> | null => {
  const value = (body ?? {}) as Record<string, unknown>
  const window = rangeOf(value.window, true)
  const quiet = rangeOf(value.quiet, false)
  const { dailyMinutes, explainPerDay } = value
  if (
    window === false ||
    quiet === false ||
    !(dailyMinutes === undefined || dailyMinutes === null || isDailyMinutes(dailyMinutes)) ||
    !(
      explainPerDay === undefined ||
      (Number.isInteger(explainPerDay) &&
        (explainPerDay as number) >= 0 &&
        (explainPerDay as number) <= MAX_EXPLAIN_PER_DAY)
    )
  )
    return null
  return {
    ...(dailyMinutes === undefined ? {} : { dailyMinutes: dailyMinutes as number | null }),
    ...(window === undefined ? {} : { window }),
    ...(quiet === undefined ? {} : { quiet }),
    ...(explainPerDay === undefined ? {} : { explainPerDay: explainPerDay as number })
  }
}

// A young profile that cannot read now: the lists and articles answer 403 time_up, with when it opens again.
export const youthGate =
  (youth: YouthStore, now: () => number): express.RequestHandler =>
  (request, response, next) => {
    if (kindOf(response) === 'adult' || !CLOSED_PATHS.some(path => request.path.startsWith(path))) {
      next()
      return
    }
    const limits = youth.limits(profileIdOf(response), now())
    if (limits.access !== 'open') {
      response.status(403).json({ error: 'time_up', access: limits.access, opensAt: limits.opensAt })
      return
    }
    // Opening a list or an article counts as time on screen too, as the app's heartbeat does: a device that stops
    // sending it (a request blocked on purpose) still has its time counted while it reads.
    youth.beat(profileIdOf(response), now())
    next()
  }

// The open profile's limits ("Aujourd'hui", the À demain screen), and its heartbeat while on screen. An adult has
// none.
export const youthMeRoutes = ({ youth, now }: { youth: YouthStore; now: () => number }) => {
  const router = express.Router()

  const limitsOf = (response: express.Response) =>
    kindOf(response) === 'adult' ? { limited: false } : { limited: true, ...youth.limits(profileIdOf(response), now()) }

  router.get('/limits', (_request, response) => {
    response.json(limitsOf(response))
  })

  router.post('/time', (_request, response) => {
    if (kindOf(response) !== 'adult') {
      const limits = youth.limits(profileIdOf(response), now())
      if (limits.access === 'open') youth.beat(profileIdOf(response), now())
    }
    response.json(limitsOf(response))
  })

  return router
}

interface YouthProfileOptions {
  youth: YouthStore
  // Its sources and themes; absent in tests that do not need them.
  sources?: YouthSources
  profiles: ProfileStore
  users?: (profileId: number) => UserStore
  now: () => number
}

type YoungOf = ReturnType<typeof youngOfProfiles>

// A young profile's fiche, for its parents: its rules, and its week (time, articles and themes, never titles).
export const youthProfileRoutes = (options: YouthProfileOptions) => {
  const router = express.Router()
  const youngOf = youngOfProfiles(options.profiles)
  mountRulesRoutes(router, options, youngOf)
  mountYouthSourceRoutes(router, options, youngOf)
  mountWeekRoute(router, options, youngOf)
  return router
}

// The young profile asked about, when the one asking is one of its parents; else the refusal is sent.
const youngOfProfiles = (profiles: ProfileStore) => (request: express.Request, response: express.Response) => {
  const id = Number(request.params.id)
  const profile = Number.isInteger(id) ? profiles.get(id) : null
  if (!profile || !isYoung(profile)) {
    response.status(404).json({ error: 'not_found' })
    return null
  }
  if (!isParentOf(response) && !isAdminOf(response)) {
    response.status(403).json({ error: 'parents_only' })
    return null
  }
  return profile
}

const mountRulesRoutes = (router: express.Router, { youth, now }: YouthProfileOptions, youngOf: YoungOf) => {
  router.get('/:id/rules', (request, response) => {
    const profile = youngOf(request, response)
    if (profile) response.json(youth.limits(profile.id, now()))
  })

  router.put('/:id/rules', (request, response) => {
    const profile = youngOf(request, response)
    if (!profile) return
    const change = parseRules(request.body)
    if (!change) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    youth.setRules(profile.id, change)
    response.json(youth.limits(profile.id, now()))
  })
}

const mountYouthSourceRoutes = (router: express.Router, { youth, sources }: YouthProfileOptions, youngOf: YoungOf) => {
  if (!sources) return
  // Its parents' catalogue for it, theme by theme, each source on or off.
  router.get('/:id/sources', (request, response) => {
    const profile = youngOf(request, response)
    if (profile) response.json({ topics: sources.catalogue(profile) })
  })

  router.put('/:id/sources', (request, response) => {
    const profile = youngOf(request, response)
    if (!profile) return
    const on = idList(request.body?.on)
    if (!on) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    sources.setSources(profile, on, profileIdOf(response))
    response.json({ topics: sources.catalogue(profile) })
  })

  // The themes its kind may see, each on unless its parents turned it off.
  const topicsOf = (profile: Profile) => {
    const hidden = youth.hiddenTopics(profile.id)
    return sources
      .topicsFor(profile.kind as 'teen' | 'child')
      .map(topic => ({ id: topic.id, label: topic.label, on: !hidden.includes(topic.id) }))
  }

  router.get('/:id/topics', (request, response) => {
    const profile = youngOf(request, response)
    if (profile) response.json({ topics: topicsOf(profile) })
  })

  router.put('/:id/topics', (request, response) => {
    const profile = youngOf(request, response)
    if (!profile) return
    const hidden = idList(request.body?.hidden)
    if (!hidden) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    sources.setHiddenTopics(profile, hidden)
    response.json({ topics: topicsOf(profile) })
  })
}

const mountWeekRoute = (router: express.Router, { youth, users, now }: YouthProfileOptions, youngOf: YoungOf) => {
  router.get('/:id/week', (request, response) => {
    const profile = youngOf(request, response)
    if (!profile) return
    const since = now() - WEEK_MS
    const readings = (users?.(profile.id).getState().readings ?? []).filter(reading => reading.at >= since)
    const topics = new Map<string, number>()
    for (const reading of readings) {
      if (reading.topicId) topics.set(reading.topicId, (topics.get(reading.topicId) ?? 0) + 1)
    }
    response.json({
      days: youth.week(profile.id, now()),
      articles: readings.filter(reading => reading.kind === 'article').length,
      videos: readings.filter(reading => reading.kind !== 'article').length,
      topics: [...topics].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count)
    })
  })
}
