import express from 'express'
import { SEEN_STORIES_RETENTION_MS, type UserStore } from '../db/user-store.ts'
import { labelIn } from '../labels.ts'
import { MAX_TOPIC_LIMIT, type NewsService, TOPIC_PAGE_SIZE } from '../news/news-service.ts'
import { profileIdOf } from './profile-routes.ts'
import type { ReaderContext } from './reader-context.ts'
import { DAY_PATTERN, isString, isTimeZone } from './validate.ts'

const MAX_QUERY_LENGTH = 100

interface NewsRoutesOptions {
  news: NewsService
  users?: (profileId: number) => UserStore
  reader: ReaderContext
  now: () => number
}

// The lists: topics, À la une, Le fil, Vidéos, trends, search and Résumé du jour.
export const newsRoutes = (options: NewsRoutesOptions) => {
  const router = express.Router()
  mountTopicRoutes(router, options)
  mountListRoutes(router, options)
  return router
}

// The themes, À la une and Résumé du jour.
const mountTopicRoutes = (
  router: express.Router,
  { news, users, reader: { youthFilterOf, filterOf, languageOf, adultsOnly }, now }: NewsRoutesOptions
) => {
  router.get('/topics', (_request, response) => {
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

  router.get('/topics/:id', async (request, response) => {
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

  router.get('/front-page', async (_request, response) => {
    const known = users?.(profileIdOf(response)).knownSince(now() - SEEN_STORIES_RETENTION_MS)
    response.json(await news.getFrontPage(filterOf(response), known, languageOf(response)))
  })

  // Every outcome is a 200 with a status. Reading the daily summary is free; writing it (POST) uses the API,
  // and "pending" asks the app to try again shortly.
  router.get('/daily-summary', (_request, response) => {
    response.json(news.getDailySummary(profileIdOf(response)))
  })

  router.post('/daily-summary', async (_request, response) => {
    if (!adultsOnly(response)) return
    response.json(await news.writeDailySummary(profileIdOf(response), filterOf(response)))
  })
}

// Search, trends, Le fil and Écouter.
const mountListRoutes = (
  router: express.Router,
  { news, reader: { youthFilterOf, filterOf, languageOf } }: NewsRoutesOptions
) => {
  router.get('/search', async (request, response) => {
    const query = request.query.q

    if (typeof query !== 'string' || query.length > MAX_QUERY_LENGTH) {
      response.status(400).json({ error: 'bad_request' })
      return
    }

    const result = await news.search(query, languageOf(response))
    const young = youthFilterOf(response)
    response.json(young ? young.search(result) : result)
  })

  router.get('/trends', async (_request, response) => {
    response.json({ trends: await news.getTrends(filterOf(response)) })
  })

  // "Le fil": ?tz=Europe/Brussels for today, &day=YYYY-MM-DD for an earlier day, &topic=<id> for one topic.
  router.get('/feed', async (request, response) => {
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

  router.get('/listen', async (_request, response) => {
    const feed = await news.getListen(languageOf(response))
    const young = youthFilterOf(response)
    response.json(young ? young.listen(feed) : feed)
  })
}
