import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { after, describe, it } from 'node:test'
import express from 'express'
import { openDatabase } from '../db/database.ts'
import { ServerSettingsStore } from '../db/server-settings-store.ts'
import { SourceStore } from '../db/source-store.ts'
import { sourceRoutes } from '../http/source-routes.ts'
import type { Catalog } from '../news/catalog.ts'
import { NewsService } from '../news/news-service.ts'

const CATALOG = {
  topics: [{ id: 'belgium', label: { fr: 'Belgique', en: 'Belgium' }, sources: [] }],
  listen: []
} as unknown as Catalog

describe('Serveur › Contenu › Sources par foyer', () => {
  it('keeps no limit by default, a number within its bounds, or none again', () => {
    const settings = new ServerSettingsStore(openDatabase(':memory:'))
    assert.equal(settings.maxSources(), null)
    settings.setMaxSources(50)
    assert.equal(settings.maxSources(), 50)
    settings.setMaxSources(null)
    assert.equal(settings.maxSources(), null)
  })

  it('reads a value outside its bounds as no limit', () => {
    const db = openDatabase(':memory:')
    db.prepare("INSERT INTO server_settings (key, value) VALUES ('maxSources', 2)").run()
    assert.equal(new ServerSettingsStore(db).maxSources(), null)
  })

  it('refuses a source once the household reaches the limit, and keeps the ones it has when lowered', async () => {
    const db = openDatabase(':memory:')
    const settings = new ServerSettingsStore(db)
    const store = new SourceStore(db)
    const app = express()
    app.use(express.json())
    app.use((_request, response, next) => {
      response.locals.profileId = 1
      next()
    })
    app.use(
      '/sources',
      sourceRoutes({
        news: new NewsService(CATALOG, { fetchText: async () => ({ text: '' }) as never, log: () => {} }),
        sources: store,
        // Each link is a feed of its own, named after its host.
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
        maxSources: () => settings.maxSources(),
        onAdded: () => {},
        now: () => 0
      })
    )
    const server = app.listen(0)
    after(() => server.close())
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/sources`
    const add = (host: string) =>
      fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: `https://${host}`, section: 'topic', topicIds: ['belgium'] })
      })
    const find = async (host: string) =>
      (await (
        await fetch(`${base}/find`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: `https://${host}` })
        })
      ).json()) as { added: number; limit: number | null }

    for (let i = 0; i < 12; i++) assert.equal((await add(`s${i}.example`)).status, 201)
    assert.equal((await find('x.example')).limit, null)

    // Lowered under what the household has: its sources stay, it cannot add one.
    settings.setMaxSources(10)
    const found = await find('x.example')
    assert.deepEqual([found.added, found.limit], [12, 10])
    const refused = await add('x.example')
    assert.equal(refused.status, 409)
    assert.deepEqual(await refused.json(), { error: 'limit' })
    assert.equal(store.count(), 12)

    settings.setMaxSources(null)
    assert.equal((await add('x.example')).status, 201)
  })
})
