import express from 'express'
import { z } from 'zod'
import { LANGUAGES } from '../../shared/i18n.ts'
import { PROFILE_COLORS } from '../db/profile-store.ts'
import {
  READING_KINDS,
  type Reading,
  type ReadingProgress,
  type SavedArticleText,
  type SavedEntry,
  type SavedItem,
  type UserStore
} from '../db/user-store.ts'

// A profile's state, shared by every device it is open on: preferences, "Enregistrés", read articles and stats.

const ITEM_ID_PATTERN = /^[\w-]{16}$/
const MAX_LIST = 300
const MAX_STRING = 300
const MAX_IMPORT_SAVED = 500
const MAX_IMPORT_READ = 5000
const MAX_IMPORT_READINGS = 5000
const MAX_ARTICLE_HTML = 400_000
const THEMES = ['system', 'light', 'dark', 'poudre'] as const
// The accent colour: the theme's own, or one of the profile colours. The names before them are still taken, from
// devices that have not updated yet.
const ACCENTS = ['auto', ...PROFILE_COLORS, 'rose', 'corail', 'ocre', 'vert', 'turquoise', 'bleu', 'lavande'] as const
const TEXT_SIZES = 5

// Body size per route: an import brings a whole device's state, the rest is small.
export const userBodyLimit = (path: string) =>
  path === '/me/import' ? '8mb' : path.startsWith('/me/saved/') ? '512kb' : '64kb'

// Request bodies are checked with zod schemas: a body that does not match is refused whole, and keys a schema does
// not name are dropped, never stored.
const text = (max = MAX_STRING) => z.string().min(1).max(max)
const itemId = z.string().regex(ITEM_ID_PATTERN)
const itemIds = z.array(itemId).min(1).max(MAX_LIST)
const fraction = z.number().min(0).max(1)
// Up to ten hours: anything longer is a tab left open.
const minutes = z.number().min(0).max(600)

const isItemId = (value: unknown): value is string => itemId.safeParse(value).success

// The value when it matches the schema, else null.
const parsed = <T>(schema: z.ZodType<T>, value: unknown): T | null => {
  const result = schema.safeParse(value)
  return result.success ? result.data : null
}

const preferencesSchema = z.object({
  topicOrder: z.array(text()).max(MAX_LIST).optional(),
  hiddenTopics: z.array(text()).max(MAX_LIST).optional(),
  hiddenSources: z.array(text()).max(MAX_LIST).optional(),
  mutedWords: z.array(text()).max(MAX_LIST).optional(),
  followedWords: z.array(text()).max(MAX_LIST).optional(),
  hideRead: z.boolean().optional(),
  theme: z.enum(THEMES).optional(),
  accent: z.enum(ACCENTS).optional(),
  // "Partages": on unless turned off; the profiles whose shares are not wanted, by id.
  sharing: z.boolean().optional(),
  mutedSharers: z.array(z.int().positive()).max(MAX_LIST).optional(),
  // The interface's language for this profile; null, the household's.
  language: z.enum(LANGUAGES).nullable().optional(),
  textSize: z
    .int()
    .min(0)
    .max(TEXT_SIZES - 1)
    .optional()
})

export const parsePreferences = (body: unknown): Record<string, unknown> | null => parsed(preferencesSchema, body)

// A saved card is kept as the app sent it, whatever its other keys: only its id is checked.
const itemSchema = z.looseObject({ id: itemId })

const parseItem = (value: unknown): SavedItem | null => parsed(itemSchema, value) as SavedItem | null

// A title or byline that does not fit is left out rather than refusing the article.
const articleSchema = z.object({
  title: text(1000).nullable().catch(null),
  byline: text(1000).nullable().catch(null),
  contentHtml: text(MAX_ARTICLE_HTML)
})

const parseArticle = (value: unknown): SavedArticleText | null => parsed(articleSchema, value)

// Minutes to a tenth: the time really spent on a short article is often under one.
const tenths = (value: number) => Math.round(value * 10) / 10

const readingSchema = z
  .object({
    id: itemId,
    sourceId: text(100),
    sourceName: text(200),
    topicId: text(100).nullish(),
    minutes,
    at: z.number(),
    kind: z.enum(READING_KINDS).optional(),
    done: z.boolean().optional(),
    progress: fraction.optional(),
    position: fraction.optional(),
    estimate: minutes.optional()
  })
  .transform(({ id, sourceId, sourceName, topicId, minutes, at, kind, done, progress, position, estimate }) => ({
    id,
    sourceId,
    sourceName,
    topicId: topicId ?? null,
    minutes: tenths(minutes),
    at,
    kind: kind ?? 'article',
    ...(done === undefined
      ? {}
      : { done, progress: progress ?? 0, position: position ?? 0, estimate: tenths(estimate ?? 0) })
  }))

const parseReading = (value: unknown): Reading | null => parsed(readingSchema, value)

const progressSchema = z
  .object({ minutes, progress: fraction, position: fraction, done: z.boolean(), estimate: minutes.optional() })
  .transform(({ minutes, progress, position, done, estimate }) => ({
    minutes: tenths(minutes),
    progress,
    position,
    done,
    ...(estimate === undefined ? {} : { estimate })
  }))

const parseProgress = (value: unknown): ReadingProgress | null => parsed(progressSchema, value)

// Entries that do not parse are dropped: an import never fails on one odd entry.
const parseList = <T>(value: unknown, max: number, parse: (entry: unknown) => T | null): T[] | null =>
  Array.isArray(value) ? value.slice(0, max).flatMap(entry => parse(entry) ?? []) : value === undefined ? [] : null

// users: the store of the profile the request is for.
export const userRoutes = ({
  users,
  now,
  onRead = () => {},
  lock = () => null
}: {
  users: (response: express.Response) => UserStore
  now: () => number
  // Readings added or moved on: the household game looks at whether they now count as read. readAt: when the
  // device says each happened, which is earlier than now for one made offline.
  onRead?: (response: express.Response, ids: string[], readAt: (id: string) => number | undefined) => void
  // What stays hidden whatever the profile sends: a young profile's sources and themes its parents did not turn on.
  lock?: (response: express.Response) => { hiddenSources: string[]; hiddenTopics: string[] } | null
}) => {
  const router = express.Router()

  // The lists sent, with what the parents keep off added back.
  const locked = (response: express.Response, preferences: Record<string, unknown>) => {
    const kept = lock(response)
    if (!kept) return preferences
    const merged = { ...preferences }
    for (const key of ['hiddenSources', 'hiddenTopics'] as const) {
      if (merged[key] !== undefined) merged[key] = [...new Set([...(merged[key] as string[]), ...kept[key]])]
    }
    return merged
  }

  // ?since=<revision>: 204 when nothing changed, so an app coming back to the foreground fetches nothing.
  router.get('/', (request, response) => {
    const since = Number(request.query.since)
    if (Number.isInteger(since) && since === users(response).revision) {
      response.status(204).end()
      return
    }
    response.json(users(response).getState())
  })

  router.put('/preferences', (request, response) => {
    const preferences = parsePreferences(request.body?.preferences)
    if (!preferences) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    response.json({ revision: users(response).setPreferences(locked(response, preferences), now()) })
  })

  router.put('/saved/:id', (request, response) => {
    const item = parseItem(request.body?.item)
    if (!item || item.id !== request.params.id) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    const article = request.body?.article === undefined ? null : parseArticle(request.body.article)
    response.json({ revision: users(response).save(item, article, now(), now()) })
  })

  router.delete('/saved/:id', (request, response) => {
    if (!isItemId(request.params.id)) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    response.json({ revision: users(response).unsave(request.params.id, now()) })
  })

  router.post('/read', (request, response) => {
    const ids = parsed(itemIds, request.body?.ids)
    if (!ids) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    response.json({ revision: users(response).markRead(ids, now(), request.body?.hidden === true) })
  })

  // "À la une" stories looked at, so the next front page shows others first.
  router.post('/stories/seen', (request, response) => {
    const ids = parsed(itemIds, request.body?.ids)
    if (!ids) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    users(response).markStoriesSeen(ids, now())
    response.status(204).end()
  })

  // "Marquer comme non lu" on one article; "Effacer l'historique" on them all.
  router.delete('/read/:id', (request, response) => {
    if (!isItemId(request.params.id)) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    response.json({ revision: users(response).markUnread([request.params.id], now()) })
  })

  router.delete('/read', (_request, response) => {
    response.json({ revision: users(response).clearRead(now()) })
  })

  router.post('/readings', (request, response) => {
    const readings = parseList(request.body?.readings, MAX_LIST, parseReading)
    if (!readings || readings.length === 0) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    const revision = users(response).addReadings(readings, now())
    const opened = new Map(readings.map(reading => [reading.id, reading.at]))
    onRead(
      response,
      readings.map(reading => reading.id),
      id => opened.get(id)
    )
    response.json({ revision })
  })

  // How much of an open article was read, sent while it is open and when it is left.
  router.patch('/readings/:id', (request, response) => {
    const change = parseProgress(request.body)
    if (!isItemId(request.params.id) || !change) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    const revision = users(response).updateReading(request.params.id, change, now())
    // Sent by a device that waited for the network: when the progress was made there.
    const at: unknown = request.body?.at
    onRead(response, [request.params.id], () => (typeof at === 'number' && Number.isFinite(at) ? at : undefined))
    response.json({ revision })
  })

  // Taken off "Reprendre" with its cross.
  router.delete('/resume/:id', (request, response) => {
    if (!isItemId(request.params.id)) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    response.json({ revision: users(response).setAside(request.params.id, now()) })
  })

  router.delete('/readings', (_request, response) => {
    response.json({ revision: users(response).clearReadings(now()) })
  })

  // A device's state from before the database: merged once, nothing on the server is replaced.
  router.post('/import', (request, response) => {
    const body = (request.body ?? {}) as Record<string, unknown>
    const preferences = body.preferences === undefined ? null : parsePreferences(body.preferences)
    const saved = parseList(
      body.saved,
      MAX_IMPORT_SAVED,
      (entry): (SavedEntry & { article: SavedArticleText | null }) | null => {
        const value = entry as { item?: unknown; article?: unknown; savedAt?: unknown } | null
        const item = parseItem(value?.item)
        if (!item) return null
        return {
          item,
          article: value?.article ? parseArticle(value.article) : null,
          savedAt: typeof value?.savedAt === 'string' ? value.savedAt : new Date(now()).toISOString()
        }
      }
    )
    const read = parseList(body.read, MAX_IMPORT_READ, entry => (isItemId(entry) ? entry : null))
    const readings = parseList(body.readings, MAX_IMPORT_READINGS, parseReading)

    if ((body.preferences !== undefined && !preferences) || !saved || !read || !readings) {
      response.status(400).json({ error: 'bad_request' })
      return
    }

    response.json({
      revision: users(response).importState(
        { preferences: preferences && locked(response, preferences), saved, read, readings },
        now()
      )
    })
  })

  return router
}
