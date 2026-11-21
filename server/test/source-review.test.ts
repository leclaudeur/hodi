import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { after, describe, it } from 'node:test'
import express from 'express'
import { openDatabase } from '../db/database.ts'
import { SourceReviewStore } from '../db/source-review-store.ts'
import { SourceStore } from '../db/source-store.ts'
import { sourceReviewRoutes } from '../http/source-review-routes.ts'
import { sourceRoutes } from '../http/source-routes.ts'
import type { Catalog } from '../news/catalog.ts'
import { NewsService } from '../news/news-service.ts'

const catalog = () =>
  ({
    topics: [
      { id: 'belgium', label: { fr: 'Belgique', en: 'Belgium' }, sources: [] },
      { id: 'world', label: { fr: 'Monde', en: 'World' }, sources: [] }
    ],
    listen: []
  }) as unknown as Catalog

describe('À traiter › sources', () => {
  it('keeps a source out of the catalogue while it waits or once refused, and asks again when added again', () => {
    const db = openDatabase(':memory:')
    const store = new SourceStore(db)
    store.add(
      {
        id: 'p1-gamma',
        name: 'Gamma',
        url: 'https://gamma.example/feed',
        kind: 'article',
        lang: 'fr',
        domains: ['gamma.example'],
        reader: true,
        skip: [],
        addedBy: 1
      },
      'topic',
      ['belgium'],
      0
    )
    const reviews = new SourceReviewStore(db)
    assert.equal(reviews.validating(), false)
    reviews.setValidating(true)
    assert.equal(reviews.validating(), true)

    reviews.ask('p1-gamma', 10)
    assert.deepEqual([...reviews.unlisted()], ['p1-gamma'])
    assert.equal(reviews.decide('p1-gamma', { state: 'refused', teen: false, child: false }, 20), true)
    assert.deepEqual([...reviews.unlisted()], ['p1-gamma'])
    // Decided already: nothing to decide again until it is asked anew.
    assert.equal(reviews.decide('p1-gamma', { state: 'accepted', teen: true, child: false }, 30), false)
    reviews.ask('p1-gamma', 40)
    assert.equal(reviews.get('p1-gamma')?.state, 'pending')
    assert.equal(reviews.decide('p1-gamma', { state: 'accepted', teen: true, child: false }, 50), true)
    assert.deepEqual([...reviews.unlisted()], [])
    assert.deepEqual(reviews.get('p1-gamma'), {
      sourceId: 'p1-gamma',
      state: 'accepted',
      teen: true,
      child: false,
      askedAt: 40,
      decidedAt: 50
    })
  })

  it('lists what waits without who added it, and accepts it with the topics the admin set', async () => {
    const db = openDatabase(':memory:')
    const store = new SourceStore(db)
    const reviews = new SourceReviewStore(db)
    reviews.setValidating(true)
    const news = new NewsService(catalog(), { fetchText: async () => ({ text: '' }) as never, log: () => {} })
    const added: string[] = []
    const decided: string[] = []
    const accepted: string[] = []
    const app = express()
    app.use(express.json())
    app.use((_request, response, next) => {
      response.locals.profileId = 1
      next()
    })
    app.use(
      '/sources',
      sourceRoutes({
        news,
        sources: store,
        find: async link => {
          const host = new URL(link).hostname
          return {
            status: 'ok',
            source: {
              name: host,
              url: `https://${host}/feed`,
              kind: 'article',
              lang: 'fr',
              domains: [host],
              reader: true,
              origin: 'feed',
              readable: { tried: 1, ok: 1 },
              samples: ['Un titre']
            }
          }
        },
        proposals: () => [],
        maxSources: () => null,
        onAdded: id => reviews.ask(id, 1),
        unlisted: () => reviews.unlisted(),
        onAddedAgain: (id, profileId) => added.push(`${id} ${profileId}`),
        now: () => 1
      })
    )
    app.use(
      '/reviews',
      sourceReviewRoutes({
        reviews,
        news,
        sources: store,
        onAccepted: id => accepted.push(id),
        onDecided: id => decided.push(id),
        now: () => 2
      })
    )
    const server = app.listen(0)
    after(() => server.close())
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const post = (path: string, body: unknown) =>
      fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
    const add = () => post('/sources', { url: 'https://gamma.example', section: 'topic', topicIds: ['belgium'] })

    const first = (await (await add()).json()) as { id: string }
    const listed = (await (await fetch(`${base}/reviews`)).json()) as {
      validating: boolean
      sources: Record<string, unknown>[]
    }
    assert.equal(listed.validating, true)
    assert.deepEqual(
      listed.sources.map(source => [source.id, source.name, source.topicIds, source.askedAt]),
      [[first.id, 'gamma.example', ['belgium'], 1]]
    )
    assert.equal('addedBy' in listed.sources[0]!, false)

    // Its link again, while it waits: into this person's list, not refused as already there.
    const again = await add()
    assert.equal(again.status, 201)
    assert.deepEqual(added, [`${first.id} 1`])
    const found = (await (await post('/sources/find', { url: 'https://gamma.example' })).json()) as {
      followed: unknown
    }
    assert.equal(found.followed, null)

    assert.equal((await post(`/reviews/sources/${first.id}`, { decision: 'maybe' })).status, 400)
    assert.equal((await post(`/reviews/sources/${first.id}`, { decision: 'accept', topicIds: ['nope'] })).status, 400)
    const accept = await post(`/reviews/sources/${first.id}`, {
      decision: 'accept',
      topicIds: ['world'],
      teen: true
    })
    assert.equal(accept.status, 204)
    assert.deepEqual([decided, accepted], [[first.id], [first.id]])
    assert.deepEqual(
      news.catalog.topics.filter(topic => topic.sources.some(source => source.id === first.id)).map(topic => topic.id),
      ['world']
    )
    assert.equal(reviews.get(first.id)?.teen, true)
    // In the catalogue now: its link is « already there ».
    assert.equal((await add()).status, 409)
    assert.equal((await post(`/reviews/sources/${first.id}`, { decision: 'refuse' })).status, 404)
  })
})
