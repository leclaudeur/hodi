import express from 'express'
import type { SourceReviewStore } from '../db/source-review-store.ts'
import type { SourceStore } from '../db/source-store.ts'
import type { NewsService } from '../news/news-service.ts'

// À traiter's sources, for the server's admin: whether the server validates them (Serveur › Contenu), those that
// wait, and the decision on each. The admin sees the source, never who added it.

interface SourceReviewRoutesOptions {
  reviews: SourceReviewStore
  news: NewsService
  sources: SourceStore
  // The source reaches the catalogue: everyone's lists hear of one more to add.
  onAccepted: (sourceId: string) => void
  // It leaves À traiter.
  onDecided: (sourceId: string) => void
  now: () => number
}

const MAX_TOPICS = 8

// The topics the admin chose: known topic ids, one at least.
const topicIdsOf = (value: unknown, known: Set<string>) =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.length <= MAX_TOPICS &&
  value.every(id => typeof id === 'string' && known.has(id)) &&
  new Set(value).size === value.length
    ? (value as string[])
    : null

export const sourceReviewRoutes = ({
  reviews,
  news,
  sources,
  onAccepted,
  onDecided,
  now
}: SourceReviewRoutesOptions) => {
  const router = express.Router()
  const topicsOf = (sourceId: string) =>
    news.catalog.topics.filter(topic => topic.sources.some(source => source.id === sourceId)).map(topic => topic.id)

  router.get('/', (_request, response) => {
    const statuses = new Map(news.getSourceStatuses().map(source => [source.id, source]))
    const waiting = reviews.pending().flatMap(review => {
      const source = statuses.get(review.sourceId)
      if (!source) return []
      const { id, name, site, kind, lang, description } = source
      return [
        {
          id,
          name,
          site,
          kind,
          lang,
          description: description ?? null,
          topicIds: topicsOf(id),
          askedAt: review.askedAt
        }
      ]
    })
    response.set('Cache-Control', 'no-store')
    response.json({ validating: reviews.validating(), sources: waiting })
  })

  router.put('/validation', (request, response) => {
    const on: unknown = request.body?.on
    if (typeof on !== 'boolean') {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    reviews.setValidating(on)
    response.json({ validating: on })
  })

  // Accepter: into the catalogue, with the topics the admin set and its « OK ados », « OK enfants ». Refuser: it
  // stays with those who read it, out of the catalogue.
  router.post('/sources/:id', (request, response) => {
    const id = request.params.id
    const decision: unknown = request.body?.decision
    const teen = request.body?.teen === true
    const child = request.body?.child === true
    const review = reviews.get(id)
    if (!review || review.state !== 'pending') {
      response.status(404).json({ error: 'not_found' })
      return
    }
    if (decision !== 'accept' && decision !== 'refuse') {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    const source = news.getSourceStatuses().find(candidate => candidate.id === id)
    const known = new Set(news.catalog.topics.map(topic => topic.id))
    const topicIds = request.body?.topicIds === undefined ? null : topicIdsOf(request.body.topicIds, known)
    if (request.body?.topicIds !== undefined && (!topicIds || source?.kind !== 'article')) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    if (decision === 'accept' && topicIds && news.setSourceTopics(id, topicIds)) sources.setTopics(id, topicIds)
    reviews.decide(id, { state: decision === 'accept' ? 'accepted' : 'refused', teen, child }, now())
    onDecided(id)
    if (decision === 'accept') onAccepted(id)
    response.status(204).end()
  })

  return router
}
