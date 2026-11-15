import express from 'express'
import type { UserStore } from '../db/user-store.ts'
import type { YouthStore } from '../db/youth-store.ts'
import { CHANNEL_LIMITS, ENGAGEMENT_WINDOW_MS, MIN_HISTORY_MS, sourceEngagement } from '../news/engagement.ts'
import type { NewsService } from '../news/news-service.ts'
import type { SourceIcons } from '../news/source-icons.ts'
import { kindOf, profileIdOf } from './profile-routes.ts'

// The sources as a profile sees them: the list, how much each is opened, and their icons.
export const sourceViewRoutes = ({
  news,
  users,
  youth,
  icons,
  now
}: {
  news: NewsService
  users?: (profileId: number) => UserStore
  youth?: YouthStore
  icons?: SourceIcons
  now: () => number
}) => {
  const router = express.Router()

  // "Peu ouvertes": the share of each shown source this profile opened over the last 30 days (or since its first
  // reading, once that is MIN_HISTORY_MS old), sites and channels judged apart.
  if (users) {
    router.get('/sources/engagement', (_request, response) => {
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

  // A young profile sees only the sources its parents gave it.
  router.get('/sources', (_request, response) => {
    const all = news.getSourceStatuses()
    const allowed = kindOf(response) === 'adult' || !youth ? null : new Set(youth.allowedSources(profileIdOf(response)))
    response.json({ sources: allowed ? all.filter(source => allowed.has(source.id)) : all })
  })

  // Nor does it add, change or remove one: a teen asks its parents ("Demander une source"), a child asks nothing.
  router.use('/sources', (request, response, next) => {
    if (request.method === 'GET' || kindOf(response) === 'adult') next()
    else response.status(403).json({ error: 'young' })
  })

  router.get('/sources/:id/icon', async (request, response) => {
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

  return router
}
