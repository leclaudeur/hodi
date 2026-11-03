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
import type { FindResult } from '../news/source-finder.ts'
import type { NewsService } from '../news/news-service.ts'
import type { YouthSources } from '../news/youth-sources.ts'
import { isAdminOf, isParentOf, kindOf, profileIdOf } from './profile-routes.ts'

const MAX_IDS = 300
const MAX_LINK_LENGTH = 500
// A teen waits for its parents' answers past this many: a short list for them, and no flood.
export const MAX_PENDING_REQUESTS = 3

const idList = (value: unknown) =>
  Array.isArray(value) &&
  value.length <= MAX_IDS &&
  value.every(id => typeof id === 'string' && id.length > 0 && id.length <= 100)
    ? [...new Set(value as string[])]
    : null

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

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

// A young profile's fiche, for its parents: its rules, and its week (time, articles and themes, never titles).
export const youthProfileRoutes = ({
  youth,
  sources,
  profiles,
  users,
  now
}: {
  youth: YouthStore
  // Its sources and themes; absent in tests that do not need them.
  sources?: YouthSources
  profiles: ProfileStore
  users?: (profileId: number) => UserStore
  now: () => number
}) => {
  const router = express.Router()

  // The young profile asked about, when the one asking is one of its parents; else the refusal is sent.
  const youngOf = (request: express.Request, response: express.Response) => {
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

  if (sources) {
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

  return router
}

// "Demander une source": a teen pastes a link, the source is looked for (through the SSRF guard), and waits for a
// parent. A child asks for nothing.
export const sourceRequestMeRoutes = ({
  youth,
  find,
  news,
  now,
  onRequest
}: {
  youth: YouthStore
  find: (link: string) => Promise<FindResult>
  news: NewsService
  now: () => number
  // The parents hear of it.
  onRequest: (request: ReturnType<YouthStore['addRequest']>) => void
}) => {
  const router = express.Router()

  router.get('/source-requests', (_request, response) => {
    response.json({ requests: youth.requests({ profileId: profileIdOf(response), status: 'pending' }) })
  })

  // Its parents' answers not seen yet, shown once on top of its Réglages.
  router.get('/source-requests/answers', (_request, response) => {
    response.json({ answers: youth.answers(profileIdOf(response)) })
  })

  router.post('/source-requests/answers/seen', (request, response) => {
    const ids: unknown = request.body?.ids
    if (!Array.isArray(ids) || ids.length > 100 || !ids.every(id => Number.isInteger(id))) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    youth.seeAnswers(profileIdOf(response), ids as number[])
    response.status(204).end()
  })

  router.post('/source-requests', async (request, response) => {
    if (kindOf(response) !== 'teen') {
      response.status(403).json({ error: 'teens_only' })
      return
    }
    const link: unknown = request.body?.url
    if (typeof link !== 'string' || !link.trim() || link.length > MAX_LINK_LENGTH) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    if (youth.requests({ profileId: profileIdOf(response), status: 'pending' }).length >= MAX_PENDING_REQUESTS) {
      response.status(409).json({ error: 'full' })
      return
    }
    const result = await find(link.trim())
    // A site's feed or a YouTube channel; channel: anything else (a podcast), which only a parent adds.
    if (result.status !== 'ok' || (result.source.kind !== 'article' && result.source.kind !== 'video')) {
      response.status(422).json({ error: result.status === 'ok' ? 'channel' : result.status })
      return
    }
    const profileId = profileIdOf(response)
    const allowed = new Set(youth.allowedSources(profileId))
    const following = [...news.catalog.topics, ...news.catalog.listen]
      .flatMap(section => section.sources)
      .some(source => source.url === result.source.url && allowed.has(source.id))
    const pending = youth
      .requests({ profileId, status: 'pending' })
      .some(entry => entry.source.url === result.source.url)
    if (following || pending) {
      response.status(409).json({ error: following ? 'following' : 'pending' })
      return
    }
    const { name, url, kind, lang, domains, reader } = result.source
    // Its id is made when a parent accepts it, as theirs.
    const added = youth.addRequest(profileId, { id: '', name, url, kind, lang, domains, reader, skip: [] }, now())
    onRequest(added)
    response.status(201).json(added)
  })

  return router
}

// The parents' side: every pending request ("Demandes"), each accepted (on for that teen only) or refused.
export const sourceRequestRoutes = ({
  youth,
  sources,
  news,
  profiles,
  now
}: {
  youth: YouthStore
  sources: YouthSources
  news: NewsService
  profiles: ProfileStore
  now: () => number
}) => {
  const router = express.Router()

  const parentsOnly = (response: express.Response) => {
    if (isParentOf(response) || isAdminOf(response)) return true
    response.status(403).json({ error: 'parents_only' })
    return false
  }

  router.get('/', (_request, response) => {
    if (parentsOnly(response)) response.json({ requests: youth.requests({ status: 'pending' }) })
  })

  // accept: true or false; topicIds: where a source new to the household goes (Monde unless said). A channel goes to
  // a section of "Vidéos" (Divers unless said).
  router.post('/:id', (request, response) => {
    if (!parentsOnly(response)) return
    const entry = youth.request(Number(request.params.id))
    const profile = entry ? profiles.get(entry.profileId) : null
    const accept: unknown = request.body?.accept
    const topicIds = request.body?.topicIds === undefined ? undefined : idList(request.body.topicIds)
    if (!entry || entry.status !== 'pending' || !profile) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    const section = entry.source.kind === 'video' ? 'listen' : 'topic'
    const fallback = section === 'listen' ? 'divers' : 'monde'
    const known = new Set((section === 'listen' ? news.catalog.listen : news.catalog.topics).map(group => group.id))
    const topics = topicIds ?? [known.has(fallback) ? fallback : [...known][0]!]
    if (typeof accept !== 'boolean' || topics.length === 0 || topics.some(id => !known.has(id))) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    if (accept && !sources.accept(profile, entry.source, section, topics, profileIdOf(response))) {
      response.status(400).json({ error: 'bad_section' })
      return
    }
    youth.decide(entry.id, accept ? 'accepted' : 'refused', now())
    response.json({ requests: youth.requests({ status: 'pending' }) })
  })

  return router
}
