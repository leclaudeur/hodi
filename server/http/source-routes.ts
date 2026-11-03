import express from 'express'
import type { SourceStore } from '../db/source-store.ts'
import type { Source } from '../news/catalog.ts'
import type { NewsService } from '../news/news-service.ts'
import type { FindResult } from '../news/source-finder.ts'
import { isAdminOf, profileIdOf } from './profile-routes.ts'

// "Ajouter une source": a profile pastes a link, sees what it would follow, picks its topics, adds it to the
// household's catalogue; or adds one of sources.yml's proposals. The household holds up to maxSources; each
// profile removes only its own, the admin any. A source added shows for the profile that added it: the others
// find it off, in "Ajoutées par le foyer".

const MAX_LINK_LENGTH = 500
// The same link looked at, then added: found once.
const FOUND_TTL_MS = 10 * 60 * 1000
// Of the sites the AI names, the ones offered.
const MAX_SUGGESTIONS = 4

export const slug = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'source'

// A source's home page, from its first domain or its feed's host.
const siteOf = (source: Source) => {
  const host = source.domains[0] ?? new URL(source.url).hostname
  return `https://${host}/`
}

export const sourceRoutes = ({
  news,
  sources,
  find,
  proposals,
  maxSources,
  onAdded,
  now
}: {
  news: NewsService
  sources: SourceStore
  find: (link: string) => Promise<FindResult>
  // sources.yml's sources not in the catalogue, with their topic.
  proposals: () => { source: Source; topicId: string }[]
  maxSources: number
  // Turned off for the household's other profiles.
  onAdded: (sourceId: string, profileId: number) => void
  now: () => number
}) => {
  const router = express.Router()
  const found = new Map<string, { at: number; result: Promise<FindResult> }>()

  const lookUp = (link: string) => {
    for (const [key, entry] of found) if (now() - entry.at > FOUND_TTL_MS) found.delete(key)
    const known = found.get(link)
    if (known) return known.result
    const result = find(link)
    found.set(link, { at: now(), result })
    // A failure is tried again next time.
    void result.then(answer => answer.status === 'failed' && found.delete(link))
    return result
  }

  const linkOf = (request: express.Request) => {
    const link: unknown = request.body?.url
    return typeof link === 'string' && link.trim() && link.length <= MAX_LINK_LENGTH ? link.trim() : null
  }

  router.post('/find', async (request, response) => {
    const link = linkOf(request)
    if (!link) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    const result = await lookUp(link)
    const followed = result.status === 'ok' ? sources.findByUrl(result.source.url) : null
    response.json({
      ...result,
      // Already in the catalogue: nothing to add.
      followed: followed ? { id: followed.id, name: followed.name } : null,
      added: sources.count(),
      limit: maxSources
    })
  })

  // "Suggérer des sources": sites the AI names for a topic (one call, within its daily cap), each looked
  // for a feed and tried in the reader, the ones already followed left out.
  router.post('/suggest', async (request, response) => {
    const topicId: unknown = request.body?.topicId
    const replacingId: unknown = request.body?.replacing
    const topic = news.catalog.topics.find(candidate => candidate.id === topicId)
    if (!topic || (replacingId !== undefined && replacingId !== null && typeof replacingId !== 'string')) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    const replacing = topic.sources.find(source => source.id === replacingId)?.name ?? null
    const result = await news.suggestSources(topic.id, profileIdOf(response), {
      current: topic.sources.map(source => source.name),
      replacing
    })
    if (result.status !== 'ok') {
      response.json(result)
      return
    }

    // A site already in the catalogue, by its domain (feeds.lesoir.be is lesoir.be), is not offered again.
    const hostOf = (link: string) => {
      try {
        return new URL(link).hostname.toLowerCase().split('.').slice(-2).join('.')
      } catch {
        return null
      }
    }
    const followedHosts = new Set(
      [...news.catalog.topics, ...news.catalog.listen].flatMap(section =>
        section.sources.flatMap(source =>
          [hostOf(source.url), ...source.domains.map(hostOf)].filter(host => host !== null)
        )
      )
    )
    const checked = await Promise.all(
      result.sites
        .filter(site => !followedHosts.has(hostOf(site.url) ?? ''))
        .map(async site => ({ site, found: await lookUp(site.url) }))
    )
    const suggestions = checked.flatMap(({ site, found }) =>
      found.status === 'ok' &&
      found.source.kind === 'article' &&
      !sources.findByUrl(found.source.url) &&
      !followedHosts.has(hostOf(found.source.url) ?? '')
        ? [{ link: site.url, reason: site.reason, source: found.source }]
        : []
    )
    response.json({
      status: 'ok',
      suggestions: suggestions.slice(0, MAX_SUGGESTIONS),
      added: sources.count(),
      limit: maxSources
    })
  })

  // The topics of a source added: a list of known topic ids, one at least; "sectionId" alone still works.
  const topicIdsOf = (request: express.Request) => {
    const list: unknown = request.body?.topicIds ?? (request.body?.sectionId ? [request.body.sectionId] : null)
    return Array.isArray(list) &&
      list.length > 0 &&
      list.length <= 8 &&
      list.every(id => typeof id === 'string') &&
      new Set(list).size === list.length
      ? (list as string[])
      : null
  }

  const save = (
    source: Source & { addedBy: number },
    section: 'topic' | 'listen',
    sectionIds: string[],
    response: express.Response
  ) => {
    if (!news.addSource(source, section, sectionIds)) {
      response.status(400).json({ error: 'bad_section' })
      return
    }
    sources.add(source, section, sectionIds, now())
    onAdded(source.id, source.addedBy)
    response.status(201).json({ id: source.id, name: source.name })
  }

  // "Sources proposées": sources.yml's sources a profile adds in one tap, by topic.
  router.get('/proposals', (_request, response) => {
    response.json({
      proposals: proposals().map(({ source, topicId }) => ({
        id: source.id,
        name: source.name,
        topicId,
        lang: source.lang,
        site: siteOf(source)
      }))
    })
  })

  router.post('/proposals/:id', async (request, response) => {
    const proposal = proposals().find(candidate => candidate.source.id === request.params.id)
    if (!proposal) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    if (sources.count() >= maxSources) {
      response.status(409).json({ error: 'limit' })
      return
    }
    // Its site looked at first, as a link pasted: the feed found and tried, so a proposal whose site changed
    // is not added broken. The file gives its id and name.
    const result = await lookUp(proposal.source.url)
    if (result.status !== 'ok' || result.source.kind !== 'article') {
      response.status(422).json({ error: result.status === 'ok' ? 'none' : result.status })
      return
    }
    if (sources.findByUrl(result.source.url)) {
      response.status(409).json({ error: 'followed' })
      return
    }
    const { url, lang, domains, reader } = result.source
    save(
      { ...proposal.source, base: undefined, url, lang, domains, reader, addedBy: profileIdOf(response) },
      'topic',
      topicIdsOf(request) ?? [proposal.topicId],
      response
    )
  })

  router.post('/', async (request, response) => {
    const link = linkOf(request)
    const section: unknown = request.body?.section
    const sectionIds = topicIdsOf(request)
    const profileId = profileIdOf(response)
    if (!link || (section !== 'topic' && section !== 'listen') || !sectionIds) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    if (sources.count() >= maxSources) {
      response.status(409).json({ error: 'limit' })
      return
    }

    const result = await lookUp(link)
    if (result.status !== 'ok') {
      response.status(422).json({ error: result.status })
      return
    }
    const { source: found } = result
    if (sources.findByUrl(found.url)) {
      response.status(409).json({ error: 'followed' })
      return
    }
    // Videos go to a section of "Vidéos", articles and posts to a topic.
    if ((found.kind === 'article') !== (section === 'topic')) {
      response.status(400).json({ error: 'bad_section' })
      return
    }

    let id = `p${profileId}-${slug(found.name)}`
    for (let suffix = 2; sources.has(id); suffix++) id = `p${profileId}-${slug(found.name)}-${suffix}`
    const source: Source & { addedBy: number } = {
      id,
      name: found.name,
      url: found.url,
      kind: found.kind,
      lang: found.lang,
      domains: found.domains,
      reader: found.reader,
      skip: [],
      addedBy: profileId
    }
    save(source, section, sectionIds, response)
  })

  // A source's topics, changed by the profile that added it or the admin.
  router.patch('/:id', (request, response) => {
    const source = news.getSourceStatuses().find(candidate => candidate.id === request.params.id)
    const topicIds = topicIdsOf(request)
    if (!source) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    if (!topicIds || source.kind !== 'article') {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    if (source.addedBy !== profileIdOf(response) && !isAdminOf(response)) {
      response.status(403).json({ error: 'not_yours' })
      return
    }
    if (!news.setSourceTopics(source.id, topicIds)) {
      response.status(400).json({ error: 'bad_section' })
      return
    }
    sources.setTopics(source.id, topicIds)
    response.status(204).end()
  })

  router.delete('/:id', (request, response) => {
    const source = news.getSourceStatuses().find(candidate => candidate.id === request.params.id)
    if (!source) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    // The starting list's sources are only hidden: sources.yml never brings a removed one back.
    if (source.addedBy === undefined) {
      response.status(403).json({ error: 'base_source' })
      return
    }
    if (source.addedBy !== profileIdOf(response) && !isAdminOf(response)) {
      response.status(403).json({ error: 'not_yours' })
      return
    }
    sources.remove(source.id)
    news.removeSource(source.id)
    response.status(204).end()
  })

  return router
}
