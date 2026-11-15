import express from 'express'
import type { ProfileStore } from '../db/profile-store.ts'
import type { YouthStore } from '../db/youth-store.ts'
import type { FindResult } from '../news/source-finder.ts'
import type { NewsService } from '../news/news-service.ts'
import type { YouthSources } from '../news/youth-sources.ts'
import { isAdminOf, isParentOf, kindOf, profileIdOf } from './profile-routes.ts'
import { MAX_PENDING_REQUESTS, idList } from './youth-routes.ts'

const MAX_LINK_LENGTH = 500

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
    const fallback = section === 'listen' ? 'other' : 'world'
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
