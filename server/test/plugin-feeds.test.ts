import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import express from 'express'
import { openDatabase } from '../db/database.ts'
import { PluginStore } from '../db/plugin-store.ts'
import { SourceStore } from '../db/source-store.ts'
import { sourceRoutes } from '../http/source-routes.ts'
import type { Catalog } from '../news/catalog.ts'
import { NewsService } from '../news/news-service.ts'
import { MAX_FEED_ITEMS, feedEntries, feedSource, pluginFeedReader, withPluginFeeds } from '../plugins/feeds.ts'
import { PLUGIN_API, parseManifest } from '../plugins/manifest.ts'
import { type PluginRegistry, loadPlugins } from '../plugins/registry.ts'

const NOW = Date.parse('2026-11-08T12:00:00Z')

const MANIFEST = {
  id: 'agenda',
  name: 'Agenda',
  version: '0.1.0',
  description: 'Les événements du quartier.',
  api: PLUGIN_API,
  permissions: { network: ['agenda.example'] },
  feeds: [{ key: 'events', name: 'Agenda du quartier', site: 'agenda.example', lang: 'fr', topic: 'belgium' }]
}

const SERVER = `export default {
  feeds: {
    events: async () => [
      { title: 'Brocante <b>place Flagey</b>', link: 'https://agenda.example/brocante', summary: 'Dimanche, dès 8 h.', publishedAt: '2026-11-08T09:00:00Z', image: 'https://cdn.example/b.jpg' },
      { title: 'Ailleurs', link: 'https://evil.example/x' }
    ]
  }
}`

const registries: PluginRegistry[] = []
after(async () => {
  await Promise.all(registries.map(registry => registry.stop()))
})

const load = async (manifest: object = MANIFEST, server = SERVER) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hodi-feeds-'))
  mkdirSync(path.join(dir, 'agenda'))
  writeFileSync(path.join(dir, 'agenda', 'plugin.json'), JSON.stringify(manifest))
  writeFileSync(path.join(dir, 'agenda', 'server.js'), server)
  const store = new PluginStore(openDatabase(':memory:'))
  const registry = await loadPlugins({
    dir,
    dataDir: mkdtempSync(path.join(tmpdir(), 'hodi-feeds-data-')),
    store,
    now: () => NOW,
    log: () => {}
  })
  registries.push(registry)
  return { registry, store }
}

const CATALOG: Catalog = {
  topics: [{ id: 'belgium', label: { fr: 'Belgique', en: 'Belgium' }, sources: [] } as never],
  listen: []
} as unknown as Catalog

describe('plugin feeds in plugin.json', () => {
  it('reads a feed on a site the plugin declares', () => {
    assert.deepEqual(parseManifest(MANIFEST).feeds, MANIFEST.feeds)
    assert.deepEqual(parseManifest({ ...MANIFEST, feeds: undefined }).feeds, [])
  })

  it('refuses a feed whose articles would link elsewhere, and odd values', () => {
    const feed = MANIFEST.feeds[0]!
    for (const feeds of [
      [{ ...feed, site: 'other.example' }],
      [{ ...feed, lang: 'nl' }],
      [{ ...feed, key: 'my feed' }],
      [{ ...feed, topic: 'Belgique !' }],
      [{ ...feed, name: '' }],
      [feed, feed],
      Array.from({ length: 6 }, (_, index) => ({ ...feed, key: `f${index}` })),
      'events'
    ]) {
      assert.throws(() => parseManifest({ ...MANIFEST, feeds }), JSON.stringify(feeds))
    }
  })
})

describe('a plugin feed’s articles', () => {
  const source = feedSource('agenda', parseManifest(MANIFEST).feeds[0]!)

  it('becomes a source that never opens in the reader', () => {
    assert.deepEqual(source, {
      id: 'plugin-agenda-events',
      name: 'Agenda du quartier',
      url: 'plugin:agenda/events',
      kind: 'article',
      lang: 'fr',
      domains: ['agenda.example'],
      reader: false,
      skip: []
    })
  })

  it('keeps plain text and https links on its site, once each, a hundred at most', () => {
    const entries = feedEntries(source, [
      {
        title: '<img src=x onerror=alert(1)>Fête\u0000 de quartier',
        link: 'https://www.agenda.example/fete',
        summary: '<p>Samedi</p>'
      },
      { title: 'Doublon', link: 'https://www.agenda.example/fete' },
      { title: 'En clair', link: 'http://agenda.example/clair' },
      { title: 'Ailleurs', link: 'https://agenda.example.evil.example/x' },
      { title: 'Avec un mot de passe', link: 'https://user:pw@agenda.example/x' },
      { title: '', link: 'https://agenda.example/vide' },
      {
        title: 'Image en clair',
        link: 'https://agenda.example/i',
        image: 'http://cdn.example/i.jpg',
        publishedAt: 'hier'
      },
      null,
      'texte'
    ])
    assert.deepEqual(
      entries.map(({ item }) => [item.title, item.link, item.summary, item.image, item.publishedAt, item.sourceId]),
      [
        ['Fête de quartier', 'https://www.agenda.example/fete', 'Samedi', null, null, 'plugin-agenda-events'],
        ['Image en clair', 'https://agenda.example/i', '', null, null, 'plugin-agenda-events']
      ]
    )
    const many = Array.from({ length: MAX_FEED_ITEMS + 20 }, (_, index) => ({
      title: `N° ${index}`,
      link: `https://agenda.example/${index}`
    }))
    assert.equal(feedEntries(source, many).length, MAX_FEED_ITEMS)
    assert.throws(() => feedEntries(source, { title: 'pas une liste' }), /list/)
  })
})

describe('a plugin feed in Hodi', () => {
  it('is offered in its topic while the plugin is on, and read through it', async () => {
    const { registry, store } = await load()
    const offered = withPluginFeeds(CATALOG, registry)
    assert.deepEqual(
      offered.topics[0]!.sources.map(source => source.id),
      ['plugin-agenda-events']
    )
    assert.equal(CATALOG.topics[0]!.sources.length, 0)

    const read = pluginFeedReader(() => registry)
    const entries = await read(offered.topics[0]!.sources[0]!)
    assert.deepEqual(
      entries.map(({ item }) => [item.title, item.image, item.publishedAt]),
      [['Brocante place Flagey', 'https://cdn.example/b.jpg', '2026-11-08T09:00:00.000Z']]
    )

    // Turned off: nothing offered, and a followed feed fails until it is on again.
    store.setEnabled('agenda', false)
    assert.equal(withPluginFeeds(CATALOG, registry).topics[0]!.sources.length, 0)
    await assert.rejects(read(feedSource('agenda', parseManifest(MANIFEST).feeds[0]!)), /plugin_unavailable/)
  })

  it('reads only the feeds plugin.json declares, and leaves out a topic Hodi does not have', async () => {
    const { registry } = await load(
      { ...MANIFEST, feeds: [{ ...MANIFEST.feeds[0], topic: 'nowhere' }] },
      SERVER.replace('events:', 'events: async () => [], hidden:')
    )
    await assert.rejects(registry.readFeed('agenda', 'hidden'), /plugin_unavailable/)
    assert.equal(withPluginFeeds(CATALOG, registry).topics[0]!.sources.length, 0)
  })

  it('lists its articles in the topic like any source', async () => {
    const { registry } = await load()
    const catalog = withPluginFeeds(CATALOG, registry)
    const calls: string[] = []
    const news = new NewsService(catalog, {
      fetchText: async url => {
        calls.push(url)
        throw new Error('not reached')
      },
      readPluginFeed: pluginFeedReader(() => registry),
      now: () => NOW,
      log: () => {}
    })
    const listed = await news.getTopic('belgium')
    assert.deepEqual(
      listed?.items.map(item => [item.title, item.sourceName]),
      [['Brocante place Flagey', 'Agenda du quartier']]
    )
    assert.deepEqual(calls, [])
  })
})

describe('adding a plugin feed from « Ajouter une source »', () => {
  it('adds it in one tap, without looking up an address', async () => {
    const { registry } = await load()
    const db = openDatabase(':memory:')
    const store = new SourceStore(db)
    const looked: string[] = []
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
        find: async link => {
          looked.push(link)
          return { status: 'failed' }
        },
        proposals: () => store.proposals(withPluginFeeds(CATALOG, registry)),
        maxSources: () => 10,
        onAdded: () => {},
        now: () => NOW
      })
    )
    const server = app.listen(0)
    after(() => server.close())
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/sources`

    const proposals = (await (await fetch(`${base}/proposals`)).json()) as { proposals: unknown[] }
    assert.deepEqual(proposals.proposals, [
      {
        id: 'plugin-agenda-events',
        name: 'Agenda du quartier',
        topicId: 'belgium',
        lang: 'fr',
        site: 'https://agenda.example/'
      }
    ])
    assert.equal((await fetch(`${base}/proposals/plugin-agenda-events`, { method: 'POST' })).status, 201)
    assert.deepEqual(looked, [])
    assert.equal(store.findByUrl('plugin:agenda/events')?.reader, false)
    assert.deepEqual(((await (await fetch(`${base}/proposals`)).json()) as { proposals: [] }).proposals, [])
  })
})
