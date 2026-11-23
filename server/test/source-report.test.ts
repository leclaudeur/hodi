import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { after, describe, it } from 'node:test'
import express from 'express'
import { openDatabase } from '../db/database.ts'
import { IGNORED_MS, SourceReportStore } from '../db/source-report-store.ts'
import { SourceReviewStore } from '../db/source-review-store.ts'
import { SourceStore } from '../db/source-store.ts'
import { UserAccountStore } from '../db/user-account-store.ts'
import { REPORTS_PER_HOUR, reportDecisionRoutes, sourceReportRoutes } from '../http/source-report-routes.ts'
import { sourceRoutes } from '../http/source-routes.ts'
import type { Catalog } from '../news/catalog.ts'
import { NewsService } from '../news/news-service.ts'

const catalog = () =>
  ({
    topics: [{ id: 'belgium', label: { fr: 'Belgique', en: 'Belgium' }, sources: [] }],
    listen: []
  }) as unknown as Catalog

// A server with one source added, reported by whoever the request's x-account header says.
const start = ({ hidden = new Set<string>(), clock = { now: 5 } } = {}) => {
  const db = openDatabase(':memory:')
  const store = new SourceStore(db)
  const reviews = new SourceReviewStore(db)
  const reports = new SourceReportStore(db)
  const news = new NewsService(catalog(), { fetchText: async () => ({ text: '' }) as never, log: () => {} })
  const told: string[] = []
  const decided: string[] = []
  const unlisted: string[] = []
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
      onAdded: () => {},
      now: () => 1
    }),
    sourceReportRoutes({
      reports,
      news,
      accountOf: response => {
        const header = response.req.get('x-account')
        return header ? Number(header) : null
      },
      visible: (_response, id) => !hidden.has(id),
      onFirst: source => told.push(source.name),
      now: () => clock.now
    })
  )
  app.use(
    '/reports',
    reportDecisionRoutes({
      reports,
      reviews,
      news,
      onUnlisted: id => unlisted.push(id),
      onDecided: id => decided.push(id),
      now: () => 9
    })
  )
  const server = app.listen(0)
  after(() => server.close())
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const post = (path: string, body: unknown, account?: number) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(account ? { 'x-account': String(account) } : {}) },
      body: JSON.stringify(body)
    })
  return { db, base, post, reports, reviews, told, decided, unlisted }
}

const addSource = async (post: ReturnType<typeof start>['post']) =>
  (
    (await (
      await post('/sources', { url: 'https://gamma.example', section: 'topic', topicIds: ['belgium'] })
    ).json()) as { id: string }
  ).id

describe('Signaler a source', () => {
  it('takes one report per account, with a reason, and tells À traiter once', async () => {
    const { post, reports, told } = start()
    const id = await addSource(post)
    // No account reading here, a reason it does not know, a source it does not have.
    assert.equal((await post(`/sources/${id}/report`, { reason: 'illegal' })).status, 403)
    assert.equal((await post(`/sources/${id}/report`, { reason: 'boring' }, 1)).status, 400)
    assert.equal((await post('/sources/nope/report', { reason: 'illegal' }, 1)).status, 404)

    assert.equal((await post(`/sources/${id}/report`, { reason: 'illegal' }, 1)).status, 204)
    // The same account again only changes its reason; another account adds one.
    assert.equal((await post(`/sources/${id}/report`, { reason: 'hateful' }, 1)).status, 204)
    assert.equal((await post(`/sources/${id}/report`, { reason: 'hateful' }, 2)).status, 204)
    assert.deepEqual(told, ['gamma.example'])
    assert.deepEqual(reports.get(id), {
      sourceId: id,
      count: 2,
      reasons: { illegal: 0, hateful: 2, misleading: 0, other: 0 },
      // The day only: to the millisecond, it would point at who was on then.
      lastAt: 0
    })
  })

  it('hears an ignored account again after 30 days, keeps hidden sources unknown, and limits each account', async () => {
    const clock = { now: 5 }
    const hidden = new Set<string>()
    const { post, told } = start({ hidden, clock })
    const id = await addSource(post)
    await post(`/sources/${id}/report`, { reason: 'other' }, 1)
    await post(`/reports/${id}`, { decision: 'ignore' })
    // The admin ignored it at 9.
    clock.now = 10 + IGNORED_MS
    await post(`/sources/${id}/report`, { reason: 'other' }, 1)
    assert.deepEqual(told, ['gamma.example', 'gamma.example'])

    // A source waiting in À traiter or refused, outside this person's list: as if it did not exist.
    hidden.add(id)
    assert.equal((await post(`/sources/${id}/report`, { reason: 'other' }, 2)).status, 404)
    hidden.clear()

    // Ten an hour per account, then 429; the next hour, again.
    for (let count = 2; count <= REPORTS_PER_HOUR; count++)
      assert.equal((await post(`/sources/${id}/report`, { reason: 'other' }, 1)).status, 204)
    assert.equal((await post(`/sources/${id}/report`, { reason: 'other' }, 1)).status, 429)
    assert.equal((await post(`/sources/${id}/report`, { reason: 'other' }, 2)).status, 204)
    clock.now += 60 * 60 * 1000
    assert.equal((await post(`/sources/${id}/report`, { reason: 'other' }, 1)).status, 204)
  })

  it('shows the admin how many and why, never who, then ignores or takes the source out', async () => {
    const { db, base, post, reviews, told, decided, unlisted } = start()
    const id = await addSource(post)
    await post(`/sources/${id}/report`, { reason: 'misleading' }, 3)
    const listed = (await (await fetch(`${base}/reports`)).json()) as { reports: Record<string, unknown>[] }
    assert.deepEqual(
      listed.reports.map(report => [report.id, report.name, report.count]),
      [[id, 'gamma.example', 1]]
    )
    assert.equal(JSON.stringify(listed).includes('reporter'), false)
    assert.equal(JSON.stringify(listed).includes('a3'), false)

    assert.equal((await post(`/reports/${id}`, { decision: 'delete' })).status, 400)
    assert.equal((await post(`/reports/${id}`, { decision: 'ignore' })).status, 204)
    assert.deepEqual([decided, unlisted], [[id], []])
    assert.equal(reviews.get(id), null)
    // Decided: nothing left to decide. The account whose report was ignored is not heard again on it; another is.
    assert.equal((await post(`/reports/${id}`, { decision: 'ignore' })).status, 404)
    assert.equal((await post(`/sources/${id}/report`, { reason: 'other' }, 3)).status, 204)
    assert.deepEqual(told, ['gamma.example'])
    assert.equal((await post(`/reports/${id}`, { decision: 'ignore' })).status, 404)
    await post(`/sources/${id}/report`, { reason: 'other' }, 4)
    assert.deepEqual(told, ['gamma.example', 'gamma.example'])

    assert.equal((await post(`/reports/${id}`, { decision: 'unlist' })).status, 204)
    assert.deepEqual(unlisted, [id])
    assert.deepEqual([...reviews.unlisted()], [id])
    assert.equal(reviews.get(id)?.decidedAt, 9)
    // The reports go with the decision, and with the account that made one.
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM source_reports').get() as { n: number }).n, 0)
  })

  it('forgets an account’s reports with the account', () => {
    const { db, reports } = start()
    const account = new UserAccountStore(db).create('r@example.com', 'unused-hash', 0)!
    new SourceStore(db).add(
      {
        id: 's1',
        name: 'S',
        url: 'https://s.example/feed',
        kind: 'article',
        lang: 'fr',
        domains: ['s.example'],
        reader: true,
        skip: [],
        addedBy: 1
      },
      'topic',
      ['belgium'],
      0
    )
    reports.report('s1', account.id, 'other', 1)
    db.prepare('DELETE FROM users WHERE id = ?').run(account.id)
    assert.equal(reports.get('s1'), null)
  })
})
