import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { after, describe, it } from 'node:test'
import express from 'express'
import { openDatabase } from '../db/database.ts'
import { ProfileStore } from '../db/profile-store.ts'
import { SHARE_REPORTS_PER_DAY, ShareReportStore } from '../db/share-report-store.ts'
import { UserAccountStore } from '../db/user-account-store.ts'
import { shareDecisionRoutes, shareReportRoutes } from '../http/share-report-routes.ts'

const DAY_MS = 24 * 60 * 60 * 1000

// Sam (profile 2) sent Léa (profile 3) a few shares; the admin is profile 1's account.
const start = () => {
  const db = openDatabase(':memory:')
  const accounts = new UserAccountStore(db)
  const profiles = new ProfileStore(db)
  profiles.create('Sam', 'tech', 0)
  profiles.create('Léa', 'tech', 0)
  const sam = accounts.create('sam@example.com', 'unused-hash', 0)!
  const lea = accounts.create('lea@example.com', 'unused-hash', 0)!
  accounts.linkProfile(sam.id, 2)
  accounts.linkProfile(lea.id, 3)
  const share = (articleId: string, note: string | null = null) =>
    db
      .prepare(
        'INSERT INTO shares (profile_id, article_id, from_profile, item, shared_at, note) VALUES (3, ?, 2, ?, 0, ?)'
      )
      .run(
        articleId,
        JSON.stringify({ title: `Titre ${articleId}`, sourceName: 'Le Soir', link: 'https://x', kind: 'article' }),
        note
      )
  for (let index = 0; index <= SHARE_REPORTS_PER_DAY; index++) share(`a${index}`, index === 0 ? 'Regarde ça' : null)

  let clock = DAY_MS + 5
  const reported: number[] = []
  const decided: number[] = []
  const reports = new ShareReportStore(db)
  // Who reads: Léa's account, unless a test says no account reads here.
  let reader: number | null = lea.id
  const app = express()
  app.use(express.json())
  app.use((_request, response, next) => {
    response.locals.profileId = 3
    next()
  })
  app.use(
    shareReportRoutes({
      reports,
      accountOf: () => reader,
      profileOf: response => response.locals.profileId as number,
      onReported: id => reported.push(id),
      now: () => clock
    })
  )
  app.use(
    '/server/share-reports',
    shareDecisionRoutes({ reports, onDecided: id => decided.push(id), now: () => clock })
  )
  const server = app.listen(0)
  after(() => server.close())
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const call = (path: string, method: string, body?: unknown) =>
    fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  const report = (articleId: string, reason = 'harassment') =>
    call('/me/shares/report', 'POST', { articleId, from: 2, reason })
  return {
    db,
    sam,
    lea,
    call,
    report,
    reported,
    decided,
    setReader: (id: number | null) => (reader = id),
    later: (ms: number) => (clock += ms)
  }
}

describe('« Signaler ce partage »', () => {
  it('tells the admin of a share received, its sender and the reason, never who reported it', async () => {
    const { sam, lea, call, report, reported, setReader } = start()
    setReader(null)
    assert.equal((await report('a0')).status, 403)
    setReader(lea.id)
    assert.equal((await report('a0', 'boring')).status, 400)
    assert.equal((await call('/me/shares/report', 'POST', { articleId: 'a0', from: 'x', reason: 'spam' })).status, 400)
    assert.equal((await report('nope')).status, 404)
    assert.equal((await report('a0')).status, 204)
    assert.equal(reported.length, 1)

    const listed = (await (await call('/server/share-reports', 'GET')).json()) as { reports: Record<string, unknown>[] }
    assert.deepEqual(listed.reports, [
      {
        id: reported[0],
        sender: sam.id,
        senderName: 'Sam',
        item: { title: 'Titre a0', sourceName: 'Le Soir', link: 'https://x', kind: 'article' },
        note: 'Regarde ça',
        reason: 'harassment',
        // The day only: to the minute, it would point at who was reading then.
        day: DAY_MS
      }
    ])
  })

  it('takes one report per share, and a few a day', async () => {
    const { report, later } = start()
    assert.equal((await report('a0')).status, 204)
    assert.equal((await report('a0', 'spam')).status, 409)
    for (let index = 1; index < SHARE_REPORTS_PER_DAY; index++) assert.equal((await report(`a${index}`)).status, 204)
    const over = await report(`a${SHARE_REPORTS_PER_DAY}`)
    assert.deepEqual([over.status, await over.json()], [429, { error: 'too_many' }])
    later(DAY_MS)
    assert.equal((await report(`a${SHARE_REPORTS_PER_DAY}`)).status, 204)
  })

  it('leaves À traiter once ignored, and the same share is not reported again for a month', async () => {
    const { call, report, reported, decided, later } = start()
    await report('a0')
    const [id] = reported
    assert.equal((await call(`/server/share-reports/${id}`, 'POST', { decision: 'block' })).status, 400)
    assert.equal((await call(`/server/share-reports/${id}`, 'POST', { decision: 'ignore' })).status, 204)
    assert.deepEqual(decided, [id])
    assert.equal((await call(`/server/share-reports/${id}`, 'POST', { decision: 'ignore' })).status, 404)
    assert.deepEqual(((await (await call('/server/share-reports', 'GET')).json()) as { reports: [] }).reports, [])
    assert.equal((await report('a0')).status, 409)
    later(31 * DAY_MS)
    assert.equal((await report('a0')).status, 204)
  })

  it('keeps the report when its sender is deleted, and forgets the reporter’s with its account', async () => {
    const { db, sam, lea, call, report } = start()
    await report('a0')
    db.prepare('DELETE FROM users WHERE id = ?').run(sam.id)
    const listed = (await (await call('/server/share-reports', 'GET')).json()) as {
      reports: { sender: number | null; senderName: string }[]
    }
    assert.deepEqual(
      listed.reports.map(entry => [entry.sender, entry.senderName]),
      [[null, 'Sam']]
    )
    db.prepare('DELETE FROM users WHERE id = ?').run(lea.id)
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM share_reports').get() as { n: number }).n, 0)
  })
})
