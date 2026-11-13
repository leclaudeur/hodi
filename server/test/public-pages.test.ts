import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import express from 'express'
import { hodiCard, pageHtml, robotsTxt, servePublicPages, sitemapXml } from '../http/public-pages.ts'
import { parseManifest } from '../plugins/manifest.ts'
import { parsePublicPages } from '../plugins/public-page.ts'
import { publicPagesOf, sameAs } from '../plugins/public-pages.ts'
import type { LoadedPlugin, PluginRegistry } from '../plugins/registry.ts'

const TEMPLATE = [
  '<!doctype html>',
  '<html lang="fr">',
  '  <head>',
  '    <meta name="robots" content="noindex, nofollow" />',
  '    <title>Hod!</title>',
  '  </head>',
  '  <body><div id="root"></div></body>',
  '</html>'
].join('\n')
const BASE = 'https://hodi.example.be'

const PUBLIC_PAGES = {
  defaults: {
    title: 'Hodi · L’actu de toute la maison',
    description: 'Sans pub ni pistage.',
    image: 'assets/share.png'
  },
  routes: [
    { path: '/', lang: 'fr' },
    { path: '/en', lang: 'en' },
    { path: '/legal', lang: 'fr', title: 'Mentions légales & "toi"' },
    { path: '/en/legal', lang: 'en' },
    { path: '/de', lang: 'de' }
  ]
}

const pluginWith = (extra: Partial<LoadedPlugin> = {}): LoadedPlugin =>
  ({
    id: 'village',
    signed: true,
    dev: false,
    error: null,
    web: { publicScript: true },
    manifest: { permissions: { publicRoutes: true }, publicPages: parsePublicPages(PUBLIC_PAGES) },
    translations: { en: { publicTitle: 'Hodi · News for the whole home', publicDescription: 'No ads, no tracking.' } },
    ...extra
  }) as unknown as LoadedPlugin

const on = () => true

describe('a plugin’s public pages in plugin.json', () => {
  it('takes routes in shape, and refuses the manifest otherwise', () => {
    assert.equal(parsePublicPages(undefined), null)
    assert.deepEqual(parsePublicPages({ routes: [{ path: '/', lang: 'fr' }] }), {
      defaults: {},
      routes: [{ path: '/', lang: 'fr' }]
    })
    for (const wrong of [
      { routes: [{ path: 'https://elsewhere.example/', lang: 'fr' }] },
      { routes: [{ path: '/Legal', lang: 'fr' }] },
      {
        routes: [
          { path: '/', lang: 'fr' },
          { path: '/', lang: 'en' }
        ]
      },
      { routes: [{ path: '/', lang: 'french' }] },
      { routes: [{ path: '/', lang: 'fr', title: 'x'.repeat(71) }] },
      { routes: [{ path: '/', lang: 'fr', description: '' }] },
      { routes: [{ path: '/', lang: 'fr', image: 'server.js' }] },
      { defaults: { image: 'assets/web.js' }, routes: [] },
      { routes: 'everything' }
    ]) {
      assert.throws(() => parsePublicPages(wrong), JSON.stringify(wrong))
    }
  })

  it('asks for permissions.publicRoutes', () => {
    const manifest = { id: 'village', name: 'Village', version: '1.0.0', description: 'Foyers', api: 2 }
    assert.throws(() => parseManifest({ ...manifest, publicPages: PUBLIC_PAGES }), /permissions\.publicRoutes/)
    const parsed = parseManifest({ ...manifest, permissions: { publicRoutes: true }, publicPages: PUBLIC_PAGES })
    assert.equal(parsed.publicPages?.routes.length, 5)
  })

  it('falls back from the route, to the plugin’s defaults in its language, to Hodi’s own', () => {
    const pages = publicPagesOf([pluginWith()], on, hodiCard)
    const at = (path: string) => pages.find(page => page.path === path)!
    assert.equal(at('/').title, 'Hodi · L’actu de toute la maison')
    assert.equal(at('/').image, '/api/public/plugins/village/files/assets/share.png')
    assert.equal(at('/en').title, 'Hodi · News for the whole home')
    assert.equal(at('/en').description, 'No ads, no tracking.')
    assert.equal(at('/legal').title, 'Mentions légales & "toi"')
    const bare = publicPagesOf(
      [
        pluginWith({
          manifest: {
            permissions: { publicRoutes: true },
            publicPages: parsePublicPages({ routes: [{ path: '/', lang: 'en' }] })
          } as never,
          translations: {}
        })
      ],
      on,
      hodiCard
    )
    assert.deepEqual(bare[0], { plugin: 'village', path: '/', lang: 'en', ...hodiCard('en') })
    assert.equal(hodiCard('de').image, '/share-fr.png')
  })

  it('offers nothing from a plugin that is off, unsigned, broken or without a public page', () => {
    assert.equal(publicPagesOf([pluginWith()], () => false, hodiCard).length, 0)
    assert.equal(publicPagesOf([pluginWith({ signed: false })], on, hodiCard).length, 0)
    assert.equal(publicPagesOf([pluginWith({ error: 'broken' })], on, hodiCard).length, 0)
    assert.equal(publicPagesOf([pluginWith({ web: { publicScript: false } as never })], on, hodiCard).length, 0)
    // A second plugin never takes an address the first one has.
    const other = pluginWith({ id: 'other' })
    assert.equal(publicPagesOf([pluginWith(), other], on, hodiCard).filter(page => page.path === '/').length, 1)
  })

  it('pairs a page with its other languages by the language in front of its address', () => {
    const pages = publicPagesOf([pluginWith()], on, hodiCard)
    const at = (path: string) => pages.find(page => page.path === path)!
    assert.equal(sameAs(at('/'), at('/en')), true)
    assert.equal(sameAs(at('/legal'), at('/en/legal')), true)
    assert.equal(sameAs(at('/'), at('/legal')), false)
  })
})

describe('what search engines read', () => {
  const pages = publicPagesOf([pluginWith()], on, hodiCard)
  const at = (path: string) => pages.find(page => page.path === path)!

  it('writes the head of a public page, escaped', () => {
    const html = pageHtml(TEMPLATE, BASE, pages, at('/legal'))
    assert.match(html, /<html lang="fr">/)
    assert.match(html, /<meta name="robots" content="index, follow" \/>/)
    assert.match(html, /<title>Mentions légales &amp; &quot;toi&quot;<\/title>/)
    assert.match(html, /<link rel="canonical" href="https:\/\/hodi\.example\.be\/legal" \/>/)
    assert.match(html, /hreflang="en" href="https:\/\/hodi\.example\.be\/en\/legal"/)
    assert.match(html, /hreflang="x-default" href="https:\/\/hodi\.example\.be\/legal"/)
    assert.match(
      html,
      /og:image" content="https:\/\/hodi\.example\.be\/api\/public\/plugins\/village\/files\/assets\/share\.png"/
    )
    assert.doesNotMatch(html, /noindex/)
    const english = pageHtml(TEMPLATE, BASE, pages, at('/en'))
    assert.match(english, /<html lang="en">/)
    assert.match(english, /hreflang="x-default" href="https:\/\/hodi\.example\.be\/"/)
  })

  it('lets robots fetch what a page needs, and lists the public pages in the sitemap', () => {
    assert.equal(robotsTxt(BASE), 'User-agent: *\nAllow: /\n\nSitemap: https://hodi.example.be/sitemap.xml\n')
    const sitemap = sitemapXml(BASE, pages)
    assert.match(sitemap, /<loc>https:\/\/hodi\.example\.be\/legal<\/loc>/)
    assert.match(sitemap, /<xhtml:link rel="alternate" hreflang="en" href="https:\/\/hodi\.example\.be\/en"\/>/)
  })
})

describe('serving the public pages', () => {
  let dir: string
  let baseUrl: string
  let server: ReturnType<express.Express['listen']>
  let appUrl: string | null = BASE
  before(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'hodi-public-pages-'))
    writeFileSync(path.join(dir, 'index.html'), TEMPLATE)
    writeFileSync(path.join(dir, 'robots.txt'), 'User-agent: *\nDisallow: /\n')
    const app = express()
    app.use((_request, response, next) => {
      response.set('X-Robots-Tag', 'noindex, nofollow')
      next()
    })
    const plugins = { list: () => [pluginWith()], enabled: on } as unknown as PluginRegistry
    servePublicPages(app, dir, { plugins, appUrl: () => appUrl, isOpen: () => true })
    app.use(express.static(dir, { index: false }))
    app.use((_request, response) => {
      response.sendFile(path.join(dir, 'index.html'))
    })
    server = app.listen(0)
    await new Promise(resolve => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  after(() => {
    server.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('opens a public page to search engines, and nothing else', async () => {
    const english = await fetch(`${baseUrl}/en`)
    assert.equal(english.headers.get('x-robots-tag'), 'index, follow')
    assert.match(await english.text(), /<title>Hodi · News for the whole home<\/title>/)
    const other = await fetch(`${baseUrl}/somewhere`)
    assert.equal(other.headers.get('x-robots-tag'), 'noindex, nofollow')
    assert.match(await other.text(), /<title>Hod!<\/title>/)
    assert.match(
      await (await fetch(`${baseUrl}/robots.txt`)).text(),
      /Sitemap: https:\/\/hodi\.example\.be\/sitemap\.xml/
    )
  })

  it('leaves the app as it is for someone signed in', async () => {
    const signedIn = await fetch(`${baseUrl}/`, { headers: { cookie: 'hodi_session=abc' } })
    assert.equal(signedIn.headers.get('x-robots-tag'), 'noindex, nofollow')
    assert.match(await signedIn.text(), /<title>Hod!<\/title>/)
  })

  it('keeps everything out of search engines until the server has its address', async () => {
    appUrl = null
    assert.equal((await fetch(`${baseUrl}/`)).headers.get('x-robots-tag'), 'noindex, nofollow')
    assert.equal(await (await fetch(`${baseUrl}/robots.txt`)).text(), 'User-agent: *\nDisallow: /\n')
    appUrl = BASE
  })
})
