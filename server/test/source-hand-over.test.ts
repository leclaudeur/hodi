import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { after, describe, it } from 'node:test'
import express from 'express'
import { openDatabase } from '../db/database.ts'
import { SourceStore } from '../db/source-store.ts'
import { sourceRoutes } from '../http/source-routes.ts'
import type { Catalog } from '../news/catalog.ts'
import { NewsService } from '../news/news-service.ts'

const catalog = () =>
  ({
    topics: [{ id: 'belgium', label: { fr: 'Belgique', en: 'Belgium' }, sources: [] }],
    listen: []
  }) as unknown as Catalog

const FEED = {
  id: 'p2-blog',
  name: 'Blog',
  url: 'https://blog.example/feed',
  kind: 'article' as const,
  lang: 'fr' as const,
  domains: ['blog.example'],
  reader: true,
  skip: []
}

// Anna (profile 1) is the server's admin; Paul (profile 2) added a blog that Léa's account reads too.
describe('« Supprimer » a source its adder added, once others read it', () => {
  const start = () => {
    const db = openDatabase(':memory:')
    db.exec(`
      INSERT INTO users (id, email, password_hash, password_changed_at, created_at, server_admin)
        VALUES (1, 'anna@example.com', 'x', 0, 0, 1), (2, 'paul@example.com', 'x', 0, 0, 0);
      UPDATE profiles SET user_id = 1 WHERE id = 1;
      INSERT INTO profiles (id, account_id, name, color, position, created_at, user_id)
        VALUES (2, 1, 'Paul', 'world', 1, 0, 2);
    `)
    const store = new SourceStore(db)
    const news = new NewsService(catalog(), { fetchText: async () => ({ text: '' }) as never, log: () => {} })
    store.add({ ...FEED, addedBy: 2 }, 'topic', ['belgium'], 0)
    news.addSource({ ...FEED, addedBy: 2 }, 'topic', ['belgium'])
    const read = (owner: string) =>
      db.prepare("INSERT INTO my_sources (owner, source_id, added_at) VALUES (?, 'p2-blog', 0)").run(owner)
    read('a2')
    const left: [string, number][] = []
    let asked = { profileId: 2, serverAdmin: false }
    const app = express()
    app.use((_request, response, next) => {
      response.locals.profileId = asked.profileId
      response.locals.serverAdmin = asked.serverAdmin
      next()
    })
    app.use(
      '/sources',
      sourceRoutes({
        news,
        sources: store,
        find: async () => ({ status: 'none' }) as never,
        proposals: () => [],
        maxSources: () => null,
        onAdded: () => {},
        onLeft: (sourceId, profileId) => left.push([sourceId, profileId]),
        now: () => 0
      })
    )
    const server = app.listen(0)
    after(() => server.close())
    const remove = () =>
      fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/sources/p2-blog`, { method: 'DELETE' })
    const as = (profileId: number, serverAdmin = false) => {
      asked = { profileId, serverAdmin }
    }
    return { store, news, read, left, remove, as }
  }

  it('leaves it to those who read it, the server admin’s from then on, out of its adder’s list', async () => {
    const { store, news, read, left, remove } = start()
    read('a3')
    assert.equal((await remove()).status, 204)
    assert.equal(store.adderOf('p2-blog'), 1)
    assert.equal(news.getSourceStatuses().find(source => source.id === 'p2-blog')?.addedBy, 1)
    assert.deepEqual(left, [['p2-blog', 2]])
  })

  it('takes it away when nobody else reads it, or when the server admin removes it', async () => {
    const { store, remove } = start()
    assert.equal((await remove()).status, 204)
    assert.equal(store.has('p2-blog'), false)

    const again = start()
    again.read('a3')
    again.as(1, true)
    assert.equal((await again.remove()).status, 204)
    assert.equal(again.store.has('p2-blog'), false)
  })
})
