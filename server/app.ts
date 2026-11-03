import path from 'node:path'
import compression from 'compression'
import expressStaticGzip from 'express-static-gzip'
import express, { type ErrorRequestHandler, type RequestHandler } from 'express'
import { type ImageSize, inlineImageSources, numberInlineImages } from './news/inline-images.ts'
import { LoginThrottle } from './auth/login-throttle.ts'
import { verifyPassword } from './auth/password.ts'
import {
  PROFILE_COOKIE,
  SESSION_COOKIE,
  clearedProfileCookie,
  clearedSessionCookie,
  createSessionToken,
  readCookie,
  readProfileToken,
  sessionCookie,
  sessionKey,
  verifySessionToken
} from './auth/session.ts'
import type { Config } from './config.ts'
import type { HouseholdStore } from './db/household-store.ts'
import { type ProfileStore, isGuarded } from './db/profile-store.ts'
import { householdRoutes, setupRoutes } from './http/household-routes.ts'
import { AI_PROVIDERS, type AiProvider } from './news/ai-providers.ts'
import { SEEN_STORIES_RETENTION_MS, SHARES_RETENTION_MS, type UserStore } from './db/user-store.ts'
import { clientAddressOf } from './http/client-address.ts'
import {
  PIN_GLOBAL_MAX_FAILURES,
  PIN_MAX_FAILURES,
  isAdminOf,
  kindOf,
  profileIdOf,
  profileRoutes,
  requireAdmin
} from './http/profile-routes.ts'
import { sourceRoutes } from './http/source-routes.ts'
import {
  sourceRequestMeRoutes,
  sourceRequestRoutes,
  youthGate,
  youthMeRoutes,
  youthProfileRoutes
} from './http/youth-routes.ts'
import { YouthSources } from './news/youth-sources.ts'
import { youthFilter } from './news/youth-filter.ts'
import { textsIn } from './i18n.ts'
import type { YouthStore } from './db/youth-store.ts'
import type { SourceStore } from './db/source-store.ts'
import type { FindResult } from './news/source-finder.ts'
import type { GameStore } from './db/game-store.ts'
import type { Catalog, Language } from './news/catalog.ts'
import { labelIn } from './labels.ts'
import { securityHeaders } from './http/security-headers.ts'
import { CHANNEL_LIMITS, ENGAGEMENT_WINDOW_MS, MIN_HISTORY_MS, sourceEngagement } from './news/engagement.ts'
import { userBodyLimit, userRoutes } from './http/user-routes.ts'
import { type AlertSettings, type FollowedAlerts, isPushEndpoint } from './news/followed-alerts.ts'
import {
  AI_KINDS,
  MAX_TOPIC_LIMIT,
  type NewsService,
  NO_FILTER,
  TOPIC_PAGE_SIZE,
  readerFilterOf
} from './news/news-service.ts'
import type { AiCallKind } from './db/news-store.ts'
import type { SourceIcons } from './news/source-icons.ts'

const MAX_PASSWORD_LENGTH = 256
const MAX_QUERY_LENGTH = 100
const MAX_QUESTION_LENGTH = 300
// The word sent with a share.
const MAX_SHARE_NOTE_LENGTH = 140
// What the reader of a shared article can send back.
const REACTIONS = ['👍', '❤️', '😂', '😮']

// HTTP status of each way an AI request can fail.
const AI_ERROR_STATUS = {
  unavailable: 503,
  unknown: 404,
  unreadable: 422,
  failed: 502,
  refused: 422,
  limited: 429
} as const

const ITEM_ID_PATTERN = /^[\w-]{16}$/

const MAX_WORDS = 50
const MAX_WORD_LENGTH = 60
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const isString = (value: unknown, maxLength: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= maxLength

const wordList = (value: unknown) =>
  Array.isArray(value) && value.length <= MAX_WORDS && value.every(word => isString(word, MAX_WORD_LENGTH))
    ? (value as string[])
    : null

const isTimeZone = (value: unknown): value is string => {
  if (!isString(value, 64)) return false
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value })
    return true
  } catch {
    return false
  }
}

// A device's notification settings, or null when anything is off. Endpoints must be a known push service.
export const parseAlertSettings = (body: unknown): AlertSettings | null => {
  if (typeof body !== 'object' || body === null) return null
  const value = body as Record<string, unknown>
  const target = value.target as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | undefined
  const words = wordList(value.words)
  const mutedWords = wordList(value.mutedWords)
  const hiddenSources =
    Array.isArray(value.hiddenSources) && value.hiddenSources.length <= 300
      ? value.hiddenSources.filter((id): id is string => isString(id, 100))
      : null

  if (
    !isString(target?.endpoint, 1000) ||
    !isPushEndpoint(target.endpoint) ||
    !isString(target.keys?.p256dh, 200) ||
    !isString(target.keys?.auth, 100) ||
    !words ||
    !mutedWords ||
    !hiddenSources ||
    typeof value.quietStart !== 'string' ||
    !TIME_PATTERN.test(value.quietStart) ||
    typeof value.quietEnd !== 'string' ||
    !TIME_PATTERN.test(value.quietEnd) ||
    !isTimeZone(value.timeZone) ||
    typeof value.badge !== 'boolean' ||
    !(value.shares === undefined || typeof value.shares === 'boolean') ||
    !(value.reactions === undefined || typeof value.reactions === 'boolean')
  ) {
    return null
  }

  return {
    target: { endpoint: target.endpoint, keys: { p256dh: target.keys.p256dh, auth: target.keys.auth } },
    words,
    mutedWords,
    hiddenSources,
    quietStart: value.quietStart,
    quietEnd: value.quietEnd,
    timeZone: value.timeZone,
    badge: value.badge,
    shares: value.shares !== false,
    reactions: value.reactions !== false
  }
}

const HISTORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const MAX_HISTORY = 500
// "Reprendre" offers what was started in the last 3 days, once some of it scrolled by.
const RESUME_WINDOW_MS = 3 * 24 * 60 * 60 * 1000
const SECONDS_PER_MINUTE = 60
const RESUME_MIN_PROGRESS = 0.15
// From there an article not read for good was skimmed to its end: the reader's own threshold for read (DONE_PROGRESS).
const RESUME_MAX_PROGRESS = 0.8
const MAX_RESUME = 20

export interface AppOptions {
  news: NewsService
  // Notifications for followed subjects, when VAPID keys are set.
  alerts?: FollowedAlerts
  // The household's profiles, and each one's state shared by its devices; absent in tests that do not need them.
  profiles?: ProfileStore
  users?: (profileId: number) => UserStore
  // Source avatars; without them the app shows the sources' initials.
  icons?: SourceIcons
  // Article pictures made smaller on the server; without them the app shows the sites' originals.
  images?: {
    file: (articleId: string, width: number) => Promise<string | null>
    // Picture n inside an article's text.
    inlineFile: (articleId: string, index: number, width: number) => Promise<string | null>
    // Its size, once made.
    inlineSize: (articleId: string, index: number) => Promise<ImageSize | null>
  }
  // What the database takes on disk, and emptying its reader texts, for the settings;
  // absent in tests that do not need it.
  storage?: { usage: () => StorageUsage; clearTexts: () => void }
  // "Ajouter une source": the catalogue in the database and the feed finder; absent in tests that do not need them.
  // file: sources.yml's catalogue, whose sources not yet added are offered ("Sources proposées").
  sources?: { store: SourceStore; find: (link: string) => Promise<FindResult>; file: Catalog }
  // The household game's points (gamification.yml); absent in tests that do not need it.
  game?: GameStore
  // The young profiles' rules and time; absent in tests that do not need them.
  youth?: YouthStore
  // The household's name, password, region and AI, from the first-run screens.
  household: HouseholdStore
  // Asked in the first-run screens of a device that is not on the server's own network.
  setupCode?: string
  // The AIs a household can pick (AI_PROVIDERS); fakes in tests.
  aiProviders?: AiProvider[]
  // The household's region or AI changed.
  onHouseholdChange?: () => void
  now?: () => number
  throttle?: LoginThrottle
  // Wrong PINs, for every profile together.
  pinThrottle?: LoginThrottle
}

export interface StorageUsage {
  databaseBytes: number
  backupBytes: number
  backups: number
  articles: number
  texts: number
}

export const createApp = (
  config: Config,
  {
    news,
    alerts,
    profiles,
    users,
    icons,
    images,
    storage,
    sources,
    game,
    youth,
    household,
    setupCode = '',
    aiProviders = AI_PROVIDERS,
    onHouseholdChange = () => {},
    now = Date.now,
    throttle = new LoginThrottle(),
    pinThrottle = new LoginThrottle(PIN_MAX_FAILURES, undefined, PIN_GLOBAL_MAX_FAILURES)
  }: AppOptions
) => {
  const app = express()

  app.disable('x-powered-by')
  app.use(securityHeaders)
  // Text responses (the web bundle, the API's JSON) shrink to about a quarter, which matters most to phones on mobile
  // data: fewer bytes, an earlier first paint and less time with the radio on. Images and fonts are already compressed.
  app.use(compression())

  // Public liveness endpoint used by the Docker healthcheck.
  app.get('/health', (_request, response) => {
    response.json({ status: 'ok' })
  })

  const api = express.Router()

  // A push subscription with the followed subjects, or the reader's state, needs more room.
  const parsers = new Map<string, RequestHandler>()
  const json = (limit: string) => {
    let parser = parsers.get(limit)
    if (!parser) parsers.set(limit, (parser = express.json({ limit })))
    return parser
  }
  api.use((request, response, next) => {
    const limit = request.path.startsWith('/me/')
      ? userBodyLimit(request.path)
      : request.path === '/push/subscription'
        ? '8kb'
        : '1kb'
    json(limit)(request, response, next)
  })

  // null: the install waits for its first-run screens.
  const passwordHash = () => household.get().passwordHash

  const householdOptions = profiles
    ? {
        household,
        profiles,
        providers: aiProviders,
        now,
        secret: config.sessionSecret,
        defaultTimeZone: config.timeZone,
        setupCode,
        throttle,
        onChange: onHouseholdChange,
        // The catalogue waited for the household's language: its base sources are listed from now on.
        onSetUp: (language: Language) => {
          if (!sources) return
          const filled = sources.store.load(sources.file, now(), language)
          for (const topic of filled.topics) {
            const listed = news.catalog.topics.find(candidate => candidate.id === topic.id)?.sources ?? []
            for (const source of topic.sources) {
              if (!listed.some(candidate => candidate.id === source.id)) news.addSource(source, 'topic', [topic.id])
            }
          }
        }
      }
    : null
  if (householdOptions) api.use('/setup', setupRoutes(householdOptions))

  api.post('/login', async (request, response) => {
    const password: unknown = request.body?.password

    if (typeof password !== 'string' || password.length === 0 || password.length > MAX_PASSWORD_LENGTH) {
      response.status(400).json({ error: 'invalid_request' })
      return
    }

    const client = clientAddressOf(request)
    const decision = throttle.check(now(), client)

    if (!decision.allowed) {
      response.set('Retry-After', String(decision.retryAfterSeconds))
      response.status(429).json({ error: 'too_many_attempts', retryAfterSeconds: decision.retryAfterSeconds })
      return
    }

    const hash = passwordHash()
    if (!hash) {
      response.status(409).json({ error: 'setup_required' })
      return
    }

    if (!(await verifyPassword(password, hash))) {
      throttle.recordFailure(now(), client)
      response.status(401).json({ error: 'invalid_password' })
      return
    }

    const key = sessionKey(config.sessionSecret, hash, household.get().sessionGeneration)
    response.set('Set-Cookie', sessionCookie(createSessionToken(key, now())))
    response.status(204).end()
  })

  api.post('/logout', (_request, response) => {
    response.set('Set-Cookie', [clearedSessionCookie(), clearedProfileCookie()])
    response.status(204).end()
  })

  // What "Qui lit ?" asks before a profile is open on the device.
  const isQuiLit = (request: express.Request) =>
    (request.method === 'GET' && request.path === '/session') ||
    (request.method === 'GET' && request.path === '/profiles') ||
    (request.method === 'GET' && /^\/profiles\/\d+\/photo$/.test(request.path)) ||
    (request.method === 'PUT' && request.path === '/profiles/current')

  // Everything registered after this middleware requires a valid session.
  const requireSession: RequestHandler = (request, response, next) => {
    const token = readCookie(request.get('cookie'), SESSION_COOKIE)
    const { passwordHash: hash, sessionGeneration } = household.get()

    if (!hash) {
      response.status(401).json({ error: 'setup_required' })
      return
    }

    const key = sessionKey(config.sessionSecret, hash, sessionGeneration)
    if (!token || !verifySessionToken(token, key, now())) {
      response.status(401).json({ error: 'unauthenticated' })
      return
    }

    next()
  }

  api.use(requireSession)

  // The profile each request is for: the device's choice, or the first profile without a PIN until it has
  // made one. A profile with a PIN counts as chosen only with a cookie signed for its current PIN.
  api.use((request, response, next) => {
    const token = readProfileToken(
      readCookie(request.get('cookie'), PROFILE_COOKIE),
      config.sessionSecret,
      id => profiles?.lock(id)?.version ?? 0
    )
    const known = profiles?.list() ?? []
    const chosen = token
      ? known.find(candidate => candidate.id === token.id && (token.signed || !isGuarded(candidate)))
      : undefined
    const profile = chosen ?? known.find(candidate => !isGuarded(candidate)) ?? known[0]
    // Only profiles with a PIN, and none given here: the device reads as nobody, with no right of any profile.
    const locked = profile !== undefined && isGuarded(profile) && !chosen
    response.locals.profileId = profile?.id ?? 1
    response.locals.admin = locked ? false : profile ? profile.role === 'admin' : true
    response.locals.kind = profile?.kind ?? 'adult'
    // false: this device has not chosen yet, the app asks "Qui lit ?".
    response.locals.profileChosen = chosen !== undefined
    // Nothing but "Qui lit ?" answers: the list, the photos and the choice of a profile with its code.
    if (locked && !isQuiLit(request)) {
      response.status(403).json({ error: 'profile_locked' })
      return
    }
    next()
  })

  // A young profile's sources and themes, its parents' choice.
  const youthSources =
    youth && sources && users && profiles
      ? new YouthSources({
          youth,
          news,
          store: sources.store,
          file: sources.file,
          users,
          profiles: () => profiles.list(),
          now
        })
      : null

  // What a young profile's parents did not turn on; null for an adult.
  const youthLockOf = (response: express.Response) => {
    const profile = profiles?.get(profileIdOf(response))
    return profile && youthSources ? youthSources.lock(profile) : null
  }
  // Its lists and articles, cut to that.
  const youthFilterOf = (response: express.Response) => {
    const lock = youthLockOf(response)
    return lock ? youthFilter(lock) : null
  }

  // A young profile reads within its parents' rules.
  if (youth) {
    api.use(youthGate(youth, now))
    api.use('/me', youthMeRoutes({ youth, now }))
  }

  api.get('/session', (_request, response) => {
    response.json({
      authenticated: true,
      profileChosen: response.locals.profileChosen === true,
      language: household.get().language,
      hourCycle: household.get().hourCycle
    })
  })

  if (profiles) {
    api.use(
      '/profiles',
      profileRoutes({
        profiles,
        now,
        secret: config.sessionSecret,
        pinThrottle,
        // It starts with the base sources: the ones profiles added are off until it turns them on.
        // A young one starts with its kind's base sources only.
        onCreate: id => {
          hideSources(
            id,
            news
              .getSourceStatuses()
              .filter(source => source.addedBy !== undefined)
              .map(source => source.id)
          )
          const profile = profiles.get(id)
          if (profile) youthSources?.start(profile)
        },
        onChange: profile => youthSources?.start(profile),
        // Its devices' alerts go with it, and the sources it added (the database removes their rows).
        onDelete: id => {
          alerts?.unregisterProfile(id)
          news
            .getSourceStatuses()
            .filter(source => source.addedBy === id)
            .forEach(source => news.removeSource(source.id))
        }
      })
    )
  }

  if (profiles && youth) {
    api.use('/profiles', youthProfileRoutes({ youth, sources: youthSources ?? undefined, profiles, users, now }))
  }

  // "Demander une source": a teen asks, its parents answer in Réglages ("Demandes").
  if (youth && youthSources && profiles && sources) {
    api.use(
      '/me',
      sourceRequestMeRoutes({
        youth,
        find: sources.find,
        news,
        now,
        // Every parent's devices hear of it.
        onRequest: request => {
          const t = textsIn(household.get().language)
          const name = profiles.get(request.profileId)?.name ?? ''
          for (const parent of profiles.list().filter(profile => profile.kind === 'adult')) {
            void alerts?.notifyShare(parent.id, {
              title: t('requests.push', { name, source: request.source.name }),
              body: request.source.url,
              url: `#/reglages/demandes/${request.id}`,
              tag: `request:${request.id}`,
              badge: null
            })
          }
        }
      })
    )
    api.use('/source-requests', sourceRequestRoutes({ youth, sources: youthSources, news, profiles, now }))
  }

  if (householdOptions) api.use('/household', requireAdmin, householdRoutes(householdOptions))

  if (users) {
    // "Historique": what was read in the last 7 days, last read first, as cards.
    api.get('/me/history', (_request, response) => {
      const read = users(profileIdOf(response)).readSince(now() - HISTORY_WINDOW_MS, MAX_HISTORY)
      const entries = new Map(read.map(entry => [entry.id, entry]))
      const language = news.languageOf(profileIdOf(response))
      response.json({
        items: news.history([...entries.keys()], language).map(item => {
          const entry = entries.get(item.id)
          return { item, readAt: entry?.readAt, hidden: entry?.hidden ?? false }
        })
      })
    })
    // "Reprendre": the articles, videos and episodes started in the last days and left before their end, as cards.
    api.get('/me/resume', (_request, response) => {
      const started = users(profileIdOf(response)).resumable(
        now() - RESUME_WINDOW_MS,
        RESUME_MIN_PROGRESS,
        RESUME_MAX_PROGRESS,
        MAX_RESUME
      )
      const entries = new Map(started.map(entry => [entry.id, entry]))
      const language = news.languageOf(profileIdOf(response))
      response.json({
        items: news.history([...entries.keys()], language).map(item => {
          const entry = entries.get(item.id)!
          // A video left before its player said its length: the one read from its page, when known.
          const length =
            entry.estimate > 0 || entry.kind === 'article'
              ? entry.estimate
              : (item.media?.durationSeconds ?? 0) / SECONDS_PER_MINUTE
          return {
            item,
            position: entry.position,
            progress: entry.progress,
            // A video or an episode plays on from where it was left; an article is counted from how far it went.
            minutesLeft: Math.max(
              1,
              Math.round(length * (1 - (entry.kind === 'article' ? entry.progress : entry.position)))
            )
          }
        })
      })
    })
    // "Partages": articles sent between the household's profiles. A profile with sharing off neither sends nor
    // receives; one can also turn off what a given profile sends.
    const sharingOn = (profileId: number) => users(profileId).preferences()?.sharing !== false
    const mutedBy = (profileId: number) => {
      const muted = users(profileId).preferences()?.mutedSharers
      return Array.isArray(muted) ? (muted as number[]) : []
    }
    // Who this profile can send to: the others with sharing on that did not turn it off.
    const shareTargets = (profileId: number) =>
      sharingOn(profileId)
        ? (profiles?.list() ?? [])
            .filter(other => other.id !== profileId && sharingOn(other.id) && !mutedBy(other.id).includes(profileId))
            .map(other => other.id)
        : []

    api.get('/me/shares', (_request, response) => {
      const profileId = profileIdOf(response)
      if (!sharingOn(profileId)) {
        response.json({ items: [] })
        return
      }
      const senders = new Set(
        (profiles?.list() ?? []).filter(other => other.id !== profileId && sharingOn(other.id)).map(other => other.id)
      )
      const muted = mutedBy(profileId)
      response.json({
        items: users(profileId)
          .shares(now() - SHARES_RETENTION_MS)
          .filter(share => senders.has(share.from) && !muted.includes(share.from))
      })
    })

    api.get('/me/share-targets', (_request, response) => {
      response.json({ profiles: shareTargets(profileIdOf(response)) })
    })

    api.post('/me/shares', (request, response) => {
      const profileId = profileIdOf(response)
      const { articleId, to, note } = (request.body ?? {}) as { articleId?: unknown; to?: unknown; note?: unknown }
      const targets = shareTargets(profileId)
      if (
        typeof articleId !== 'string' ||
        (note !== undefined && note !== null && (typeof note !== 'string' || note.length > MAX_SHARE_NOTE_LENGTH)) ||
        !Array.isArray(to) ||
        to.length === 0 ||
        !to.every(id => typeof id === 'number' && targets.includes(id))
      ) {
        response.status(400).json({ error: 'bad_request' })
        return
      }
      const [item] = news.history([articleId])
      if (!item) {
        response.status(404).json({ error: 'not_found' })
        return
      }
      const sender = users(profileId)
      const word = typeof note === 'string' && note.trim() !== '' ? note.trim() : null
      ;(to as number[]).forEach(id => sender.shareTo(id, item, now(), word))
      if (word) game?.recordShare(profileId, articleId, now())
      response.json({ ok: true })

      // The other profiles' devices hear of it, each in its profile's language; the share itself is already kept.
      const from = profiles?.list().find(profile => profile.id === profileId)?.name
      for (const id of to as number[]) {
        const video = item.kind === 'video' || item.kind === 'podcast'
        const t = textsIn(news.languageOf(id))
        void alerts?.notifyShare(id, {
          title: t(`push.shared.${item.kind}`, { name: from ?? t('push.someone') }),
          body: word ? t('push.note', { note: word, title: item.title }) : item.title,
          url: video ? `#/videos/${encodeURIComponent(articleId)}` : `#/article/${encodeURIComponent(articleId)}`,
          tag: `share:${articleId}`,
          badge: null
        })
      }
    })

    // An emoji back to whoever sent the article ("Léa a réagi ❤️"), changed or taken back at will.
    api.post('/me/shares/reaction', (request, response) => {
      const profileId = profileIdOf(response)
      const { articleId, from, reaction } = (request.body ?? {}) as {
        articleId?: unknown
        from?: unknown
        reaction?: unknown
      }
      if (
        typeof articleId !== 'string' ||
        typeof from !== 'number' ||
        !(reaction === null || (typeof reaction === 'string' && REACTIONS.includes(reaction)))
      ) {
        response.status(400).json({ error: 'bad_request' })
        return
      }
      const result = users(profileId).react(articleId, from, reaction, now())
      if (!result) {
        response.status(404).json({ error: 'not_found' })
        return
      }
      if (result.changed && reaction !== null) game?.recordReaction(from, articleId, profileId, now())
      response.json({ ok: true })

      // Its sender hears of a new one, unless it turned sharing off since.
      if (!result.changed || reaction === null || !sharingOn(from)) return
      const { item } = result
      const name = profiles?.list().find(profile => profile.id === profileId)?.name
      const video = item.kind === 'video' || item.kind === 'podcast'
      const t = textsIn(news.languageOf(from))
      void alerts?.notifyShare(
        from,
        {
          title: t('push.reacted', { name: name ?? t('push.someone'), reaction }),
          body: typeof item.title === 'string' ? item.title : '',
          url: video ? `#/videos/${encodeURIComponent(articleId)}` : `#/article/${encodeURIComponent(articleId)}`,
          tag: `reaction:${articleId}:${profileId}`,
          badge: null
        },
        'reactions'
      )
    })

    // The reactions to what this profile sent, until "Partages" shows them.
    api.get('/me/shares/reactions', (_request, response) => {
      const profileId = profileIdOf(response)
      const known = new Set((profiles?.list() ?? []).map(profile => profile.id))
      response.json({
        items: sharingOn(profileId)
          ? users(profileId)
              .reactions()
              .filter(entry => known.has(entry.to))
          : []
      })
    })

    api.post('/me/shares/reactions/seen', (request, response) => {
      const { until } = (request.body ?? {}) as { until?: unknown }
      if (typeof until !== 'number' || !Number.isFinite(until)) {
        response.status(400).json({ error: 'bad_request' })
        return
      }
      users(profileIdOf(response)).markReactionsSeen(until)
      response.json({ ok: true })
    })

    // The household game: this profile's points, level, week and badges; the badge on its avatar.
    if (game) {
      // The themes the all-rounder badge asks for: those with sources.
      const gameTopics = () => news.catalog.topics.filter(topic => topic.sources.length > 0).map(topic => topic.id)

      api.get('/me/game', (_request, response) => {
        const profileId = profileIdOf(response)
        const language = news.languageOf(profileId)
        response.json({
          ...game.summary(profileId, now(), language),
          badges: game.badges(profileId, gameTopics(), language),
          badge: game.wornBadge(profileId, gameTopics()),
          news: game.news(profileId, gameTopics(), now())
        })
      })

      // The sheet showed what was new: celebrated, no longer new.
      api.post('/me/game/seen', (_request, response) => {
        game.markSeen(profileIdOf(response), gameTopics(), now())
        response.status(204).end()
      })

      api.put('/me/game/badge', (request, response) => {
        const { badge } = (request.body ?? {}) as { badge?: unknown }
        if (
          !(badge === null || typeof badge === 'string') ||
          !game.wear(profileIdOf(response), badge, gameTopics(), now())
        ) {
          response.status(400).json({ error: 'bad_request' })
          return
        }
        response.json({ badge })
      })

      // Opened from a notification of a followed subject.
      api.post('/me/game/alerts', (request, response) => {
        const { articleId } = (request.body ?? {}) as { articleId?: unknown }
        if (typeof articleId !== 'string' || articleId === '' || articleId.length > 200) {
          response.status(400).json({ error: 'bad_request' })
          return
        }
        // Only an article the server listed: a made-up id earns the badge nothing.
        if (news.history([articleId]).length > 0) game.recordAlert(profileIdOf(response), articleId, now())
        response.status(204).end()
      })

      // Statistiques > Foyer: the week's challenge and ranking, each profile with its level and badge.
      api.get('/game', (_request, response) => {
        const profileId = profileIdOf(response)
        const language = news.languageOf(profileId)
        const ranking = (profiles?.list() ?? []).map(profile => {
          const { week, level, name, progress } = game.summary(profile.id, now(), language)
          return { profileId: profile.id, week, level, name, progress, badge: game.wornBadge(profile.id, gameTopics()) }
        })
        response.json({
          enabled: game.enabled(),
          challenge: game.challenge(now()),
          ranking: ranking.sort((a, b) => b.week - a.week),
          // The profile asking: what its avatar has to show as new.
          news: game.news(profileId, gameTopics(), now())
        })
      })

      // Another profile's sheet: its level and the badges it earned.
      api.get('/game/profiles/:id', (request, response) => {
        const id = Number(request.params.id)
        if (!profiles?.list().some(profile => profile.id === id)) {
          response.status(404).json({ error: 'not_found' })
          return
        }
        const language = news.languageOf(profileIdOf(response))
        response.json({
          ...game.summary(id, now(), language),
          badges: game.badges(id, gameTopics(), language).filter(badge => badge.tier > 0),
          badge: game.wornBadge(id, gameTopics())
        })
      })

      api.put('/game/enabled', requireAdmin, (request, response) => {
        const { enabled } = (request.body ?? {}) as { enabled?: unknown }
        if (typeof enabled !== 'boolean') {
          response.status(400).json({ error: 'bad_request' })
          return
        }
        game.setEnabled(enabled)
        response.json({ enabled })
      })
    }

    // What the server knows of an article or a video read, for the game: its kind, its theme, when it came out.
    const readFacts = (id: string) => {
      const [item] = news.history([id])
      if (!item) return null
      const published = item.publishedAt === null ? NaN : Date.parse(item.publishedAt)
      return {
        kind: item.kind === 'article' ? ('article' as const) : ('video' as const),
        topicId: item.kind === 'article' ? item.topicId : null,
        publishedAt: Number.isFinite(published) ? published : null
      }
    }

    api.use(
      '/me',
      userRoutes({
        users: response => users(profileIdOf(response)),
        now,
        onRead: (response, ids, readAt) => game?.recordReads(profileIdOf(response), ids, now(), readAt, readFacts),
        lock: response => {
          const profile = profiles?.get(profileIdOf(response))
          return profile && youthSources ? youthSources.lock(profile) : null
        }
      })
    )
  }

  // "Peu ouvertes": the share of each shown source this profile opened over the last 30 days (or since its first
  // reading, once that is MIN_HISTORY_MS old), sites and channels judged apart.
  if (users) {
    api.get('/sources/engagement', (_request, response) => {
      const user = users(profileIdOf(response))
      const first = user.firstReadingAt()
      const since = Math.max(now() - ENGAGEMENT_WINDOW_MS, first ?? now())
      const judged = first !== null && now() - first >= MIN_HISTORY_MS
      const hidden = new Set(user.hiddenSources())
      const shown = news.getSourceStatuses().filter(source => !hidden.has(source.id))
      const ids = (sites: boolean) =>
        shown.filter(source => (source.kind === 'article') === sites).map(source => source.id)
      const articles = news.articleCountsBySource(since)
      const reads = user.readingsBySource(since)
      const sources = [
        ...sourceEngagement(ids(true), articles, reads),
        ...sourceEngagement(ids(false), articles, reads, CHANNEL_LIMITS)
      ]
      response.json({
        days: Math.round((judged ? now() - since : ENGAGEMENT_WINDOW_MS) / (24 * 60 * 60 * 1000)),
        sources: judged ? sources : sources.map(source => ({ ...source, low: false }))
      })
    })
  }

  // Turns sources off in a profile's preferences, on the server: its devices get the change with the state.
  const hideSources = (profileId: number, ids: string[]) => {
    if (!users || ids.length === 0) return
    const user = users(profileId)
    const hidden = user.hiddenSources()
    const added = ids.filter(id => !hidden.includes(id))
    if (added.length > 0) user.setPreferences({ hiddenSources: [...hidden, ...added] }, now())
  }

  // What the profile turned off, for the lists the server picks from (À la une, trends, Résumé du jour).
  const filterOf = (response: express.Response) => {
    const own = users ? readerFilterOf(users(profileIdOf(response)).preferences()) : NO_FILTER
    const lock = youthLockOf(response)
    return lock
      ? {
          ...own,
          hiddenSources: [...new Set([...own.hiddenSources, ...lock.hiddenSources])],
          hiddenTopics: [...new Set([...own.hiddenTopics, ...lock.hiddenTopics])]
        }
      : own
  }
  // Topic names come in the profile's language.
  const languageOf = (response: express.Response) => news.languageOf(profileIdOf(response))

  api.get('/topics', (_request, response) => {
    response.json({
      topics: news.catalog.topics.map(topic => ({
        id: topic.id,
        label: labelIn(topic, languageOf(response)),
        // Listed in the app's settings, where each source can be hidden.
        sources: topic.sources.map(source => ({
          id: source.id,
          name: source.name,
          ...(source.addedBy === undefined ? {} : { addedBy: source.addedBy })
        }))
      }))
    })
  })

  api.get('/topics/:id', async (request, response) => {
    const limit = Number(request.query.limit ?? TOPIC_PAGE_SIZE)

    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_TOPIC_LIMIT) {
      response.status(400).json({ error: 'bad_request' })
      return
    }

    const young = youthFilterOf(response)
    if (young && !young.topicShown(request.params.id)) {
      response.status(404).json({ error: 'not_found' })
      return
    }

    const topic = await news.getTopic(request.params.id, limit, {
      fresh: request.query.fresh === '1',
      language: languageOf(response)
    })

    if (!topic) {
      response.status(404).json({ error: 'not_found' })
      return
    }

    response.json(young ? young.topic(topic) : topic)
  })

  api.get('/front-page', async (_request, response) => {
    const known = users?.(profileIdOf(response)).knownSince(now() - SEEN_STORIES_RETENTION_MS)
    response.json(await news.getFrontPage(filterOf(response), known, languageOf(response)))
  })

  // Every outcome is a 200 with a status. Reading the daily summary is free; writing it (POST) uses the API,
  // and "pending" asks the app to try again shortly.
  api.get('/daily-summary', (_request, response) => {
    response.json(news.getDailySummary(profileIdOf(response)))
  })

  // Notifications: the app sends its subscription and what it follows each time it opens; the server keeps it.
  api.get('/push/key', (_request, response) => {
    if (!alerts) {
      response.status(503).json({ error: 'unavailable' })
      return
    }
    response.json({ publicKey: config.vapid.publicKey })
  })

  api.put('/push/subscription', (request, response) => {
    const settings = parseAlertSettings(request.body)
    if (!alerts) {
      response.status(503).json({ error: 'unavailable' })
      return
    }
    if (!settings) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    alerts.register({ ...settings, profileId: profileIdOf(response) })
    response.status(204).end()
  })

  api.delete('/push/subscription', (request, response) => {
    const endpoint: unknown = request.body?.endpoint
    if (typeof endpoint !== 'string') {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    alerts?.unregister(endpoint)
    response.status(204).end()
  })

  api.post('/push/seen', (request, response) => {
    const endpoint: unknown = request.body?.endpoint
    if (typeof endpoint !== 'string') {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    alerts?.markSeen(endpoint)
    response.status(204).end()
  })

  // Résumer, the questions and Résumé du jour are the adults': a young profile has its own explanations.
  const adultsOnly = (response: express.Response) => {
    if (kindOf(response) === 'adult') return true
    response.status(403).json({ error: 'young' })
    return false
  }

  api.post('/daily-summary', async (_request, response) => {
    if (!adultsOnly(response)) return
    response.json(await news.writeDailySummary(profileIdOf(response), filterOf(response)))
  })

  api.get('/search', async (request, response) => {
    const query = request.query.q

    if (typeof query !== 'string' || query.length > MAX_QUERY_LENGTH) {
      response.status(400).json({ error: 'bad_request' })
      return
    }

    const result = await news.search(query, languageOf(response))
    const young = youthFilterOf(response)
    response.json(young ? young.search(result) : result)
  })

  api.get('/ai-usage', (_request, response) => {
    const usage = news.aiUsage(profileIdOf(response))
    // Each profile's calls are the admin's to see; a member sees its own and the household's.
    response.json(isAdminOf(response) ? usage : { ...usage, profiles: [] })
  })

  // "Remettre à 0", the admin's: one kind or all, for one profile or the whole household.
  api.post('/ai-usage/reset', requireAdmin, (request, response) => {
    const { kind, profileId } = (request.body ?? {}) as { kind?: unknown; profileId?: unknown }
    if (
      !(kind === undefined || AI_KINDS.includes(kind as AiCallKind)) ||
      !(profileId === undefined || (Number.isInteger(profileId) && (profileId as number) > 0))
    ) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    news.resetAiUsage({
      kind: (kind as AiCallKind | undefined) ?? null,
      profileId: (profileId as number | undefined) ?? null
    })
    response.json(news.aiUsage(profileIdOf(response)))
  })

  if (storage) {
    api.get('/storage', requireAdmin, (_request, response) => {
      response.json(storage.usage())
    })
    api.delete('/storage/texts', requireAdmin, (_request, response) => {
      storage.clearTexts()
      response.json(storage.usage())
    })
  }

  api.get('/trends', async (_request, response) => {
    response.json({ trends: await news.getTrends(filterOf(response)) })
  })

  // "Le fil": ?tz=Europe/Brussels for today, &day=YYYY-MM-DD for an earlier day, &topic=<id> for one topic.
  api.get('/feed', async (request, response) => {
    const { day, tz, topic } = request.query

    if (
      !isTimeZone(tz) ||
      !(day === undefined || (typeof day === 'string' && DAY_PATTERN.test(day))) ||
      !(topic === undefined || isString(topic, 100))
    ) {
      response.status(400).json({ error: 'bad_request' })
      return
    }

    const feed = await news.getDay(day ?? null, tz, topic ?? null, languageOf(response))

    if (!feed) {
      response.status(400).json({ error: 'bad_request' })
      return
    }

    const young = youthFilterOf(response)
    response.json(young ? young.day(feed) : feed)
  })

  api.get('/listen', async (_request, response) => {
    const feed = await news.getListen(languageOf(response))
    const young = youthFilterOf(response)
    response.json(young ? young.listen(feed) : feed)
  })

  // A young profile sees only the sources its parents gave it.
  api.get('/sources', (_request, response) => {
    const all = news.getSourceStatuses()
    const allowed = kindOf(response) === 'adult' || !youth ? null : new Set(youth.allowedSources(profileIdOf(response)))
    response.json({ sources: allowed ? all.filter(source => allowed.has(source.id)) : all })
  })

  // Nor does it add, change or remove one: a teen asks its parents ("Demander une source"), a child asks nothing.
  api.use('/sources', (request, response, next) => {
    if (request.method === 'GET' || kindOf(response) === 'adult') next()
    else response.status(403).json({ error: 'young' })
  })

  // The image itself: kept by the browser for a week, unlike the rest of the API.
  if (sources) {
    api.use(
      '/sources',
      sourceRoutes({
        news,
        sources: sources.store,
        find: sources.find,
        proposals: () => sources.store.proposals(sources.file),
        maxSources: config.maxSources,
        // The other profiles find it off: each one turns on what it wants to read.
        onAdded: (sourceId, profileId) =>
          profiles
            ?.list()
            .filter(profile => profile.id !== profileId)
            .forEach(profile => hideSources(profile.id, [sourceId])),
        now
      })
    )
  }

  api.get('/sources/:id/icon', async (request, response) => {
    const icon = icons ? await icons.get(request.params.id) : null

    if (icon === undefined) {
      response.status(404).json({ error: 'not_found' })
      return
    }

    if (icon === null) {
      response.set('Cache-Control', 'private, max-age=86400').status(404).json({ error: 'not_found' })
      return
    }

    response.set({ 'Content-Type': icon.contentType, 'Cache-Control': 'private, max-age=604800' })
    response.send(Buffer.from(icon.data))
  })

  // A young profile sees the pictures of the articles it may open: its sources', and those sent to it or saved.
  const hiddenFromYoung = (response: express.Response, id: string) => {
    const young = youthFilterOf(response)
    if (!young) return false
    const [item] = news.history([id])
    const user = users?.(profileIdOf(response))
    return !(item && young.shown(item)) && !user?.wasSharedWith(id) && !user?.isSaved(id)
  }

  // An article's picture at one of the widths of IMAGE_WIDTHS, by the article's id: never a URL from the client.
  const sendPicture = (response: express.Response, file: string | null) => {
    if (!file) {
      // The card or the reader falls back to the site's own picture.
      response.set('Cache-Control', 'private, max-age=3600').status(404).json({ error: 'not_found' })
      return
    }
    // The same id and width always give the same picture.
    response.set('Cache-Control', 'private, max-age=604800, immutable')
    response.sendFile(file)
  }

  api.get('/images/:id/:width', async (request, response) => {
    const { id, width } = request.params
    sendPicture(
      response,
      images && ITEM_ID_PATTERN.test(id) && !hiddenFromYoung(response, id) ? await images.file(id, Number(width)) : null
    )
  })

  api.get('/images/:id/:index/:width', async (request, response) => {
    const { id, index, width } = request.params
    sendPicture(
      response,
      images && ITEM_ID_PATTERN.test(id) && /^\d{1,3}$/.test(index) && !hiddenFromYoung(response, id)
        ? await images.inlineFile(id, Number(index), Number(width))
        : null
    )
  })

  api.get('/articles/:id', async (request, response) => {
    if (!ITEM_ID_PATTERN.test(request.params.id)) {
      response.status(404).json({ error: 'not_found' })
      return
    }

    const result = await news.getArticle(request.params.id)

    // A young profile opens the articles of its sources, and those a parent sent it or it saved.
    const young = youthFilterOf(response)
    const user = users?.(profileIdOf(response))
    if (
      young &&
      result.status !== 'unknown' &&
      !young.shown(result.item) &&
      !user?.wasSharedWith(request.params.id) &&
      !user?.isSaved(request.params.id)
    ) {
      response.status(404).json({ error: 'not_found' })
      return
    }

    if (result.status === 'unknown') {
      // Saved on a device before the server kept articles: the text came with it.
      const saved = users?.(profileIdOf(response)).savedArticle(request.params.id)
      if (saved) {
        response.json({ status: 'ok', item: saved.item, article: saved.article, canSummarize: false })
        return
      }
      // The item never was in a configured feed.
      response.status(404).json({ error: 'not_found' })
      return
    }

    if (result.status === 'ok') {
      const { title, byline, contentHtml } = result.article
      // Its pictures numbered, for the reader to ask for their smaller copies, with the size of those already made.
      const sizes =
        images &&
        (await Promise.all(inlineImageSources(contentHtml).map((_, index) => images.inlineSize(result.item.id, index))))
      response.json({
        status: 'ok',
        item: result.item,
        article: { title, byline, contentHtml: sizes ? numberInlineImages(contentHtml, sizes) : contentHtml },
        canSummarize: news.canSummarize
      })
      return
    }

    response.status(result.status === 'failed' ? 502 : 200).json({ status: result.status, item: result.item })
  })

  api.post('/articles/:id/summary', async (request, response) => {
    if (!adultsOnly(response)) return
    if (!ITEM_ID_PATTERN.test(request.params.id)) {
      response.status(404).json({ error: 'not_found' })
      return
    }

    const result = await news.getSummary(request.params.id, profileIdOf(response))

    if (result.status === 'ok') {
      response.json(result)
      return
    }

    response.status(AI_ERROR_STATUS[result.status]).json({ error: result.status })
  })

  api.post('/articles/:id/question', async (request, response) => {
    if (!adultsOnly(response)) return
    const question: unknown = request.body?.question

    if (!ITEM_ID_PATTERN.test(request.params.id)) {
      response.status(404).json({ error: 'not_found' })
      return
    }

    if (typeof question !== 'string' || question.trim() === '' || question.length > MAX_QUESTION_LENGTH) {
      response.status(400).json({ error: 'bad_request' })
      return
    }

    const result = await news.answerQuestion(request.params.id, question.trim(), profileIdOf(response))

    if (result.status === 'ok') {
      response.json(result)
      return
    }

    response.status(AI_ERROR_STATUS[result.status]).json({ error: result.status })
  })

  api.use((_request, response) => {
    response.status(404).json({ error: 'not_found' })
  })

  app.use('/api', (_request, response, next) => {
    // API responses are per-user and must never be cached by the browser or a proxy.
    response.set('Cache-Control', 'no-store')
    next()
  })
  app.use('/api', api)

  // The web bundle holds no data: it is public so the login page can load.
  // Its scripts and styles were compressed once at build time, at brotli's highest level (vite.config.ts): smaller
  // than compressing them on each request, and no work for the server.
  app.use(
    '/assets',
    expressStaticGzip(path.join(config.webDir, 'assets'), {
      enableBrotli: true,
      orderPreference: ['br'],
      index: false,
      serveStatic: { immutable: true, maxAge: '1y', fallthrough: false }
    })
  )
  app.use(express.static(config.webDir, { index: false }))

  // Single-page app fallback for client-side routes.
  app.use((request, response, next) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      next()
      return
    }

    response.set('Cache-Control', 'no-cache')
    response.sendFile(path.join(config.webDir, 'index.html'))
  })

  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    const status = typeof error?.status === 'number' && error.status < 500 ? error.status : 500

    if (status === 500) {
      console.error(error)
    }

    const code = status === 500 ? 'internal_error' : status === 404 ? 'not_found' : 'bad_request'

    response.status(status).json({ error: code })
  }

  app.use(errorHandler)

  return app
}
