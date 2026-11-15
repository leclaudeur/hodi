import express from 'express'
import type { UserStore } from '../db/user-store.ts'
import type { NewsService } from '../news/news-service.ts'
import { profileIdOf } from './profile-routes.ts'

const HISTORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const MAX_HISTORY = 500
// "Reprendre" offers what was started in the last 3 days, once some of it scrolled by.
const RESUME_WINDOW_MS = 3 * 24 * 60 * 60 * 1000
const SECONDS_PER_MINUTE = 60
const RESUME_MIN_PROGRESS = 0.15
// From there an article not read for good was skimmed to its end: the reader's own threshold for read (DONE_PROGRESS).
const RESUME_MAX_PROGRESS = 0.8
const MAX_RESUME = 20

export const readingRoutes = ({
  users,
  news,
  now
}: {
  users: (profileId: number) => UserStore
  news: NewsService
  now: () => number
}) => {
  const router = express.Router()

  // "Historique": what was read in the last 7 days, last read first, as cards.
  router.get('/me/history', (_request, response) => {
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
  router.get('/me/resume', (_request, response) => {
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

  return router
}
