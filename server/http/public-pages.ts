import { readFileSync } from 'node:fs'
import path from 'node:path'
import type express from 'express'
import { SESSION_COOKIE } from '../auth/session.ts'
import { textsIn } from '../i18n.ts'
import { type HodiCard, type PublicPage, publicPagesOf, sameAs } from '../plugins/public-pages.ts'
import type { PluginRegistry } from '../plugins/registry.ts'

// Hodi's own card: its locales' texts and its banner, in French for a language Hodi does not have.
export const hodiCard: HodiCard = lang => {
  const language = lang === 'en' ? 'en' : 'fr'
  const t = textsIn(language)
  return { title: t('seo.title'), description: t('seo.description'), image: `/share-${language}.png` }
}

interface PublicPagesOptions {
  plugins: PluginRegistry
  // The address people reach Hodi at (Serveur › E-mail): without it, nothing is indexed.
  appUrl: () => string | null
  // The setup is over: before that, the only page is the wizard.
  isOpen: () => boolean
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const absolute = (base: string, page: PublicPage) => `${base}${page.path}`

const siblings = (pages: PublicPage[], page: PublicPage) => pages.filter(other => sameAs(page, other))

// The language a visitor without one of the page's languages gets: the address without a language in front.
const defaultOf = (versions: PublicPage[]) =>
  versions.find(version => !new RegExp(`^/${version.lang}(?:/|$)`).test(version.path)) ?? versions[0]!

// What goes in <head>: the result's title and line, the address it counts as, its other languages and its card.
const headOf = (base: string, pages: PublicPage[], page: PublicPage) => {
  const image = `${base}${page.image}`
  const versions = siblings(pages, page)
  const tags = [
    `<title>${escapeHtml(page.title)}</title>`,
    `<meta name="description" content="${escapeHtml(page.description)}" />`,
    `<link rel="canonical" href="${escapeHtml(absolute(base, page))}" />`,
    ...(versions.length > 1
      ? [
          ...versions.map(
            other => `<link rel="alternate" hreflang="${other.lang}" href="${escapeHtml(absolute(base, other))}" />`
          ),
          `<link rel="alternate" hreflang="x-default" href="${escapeHtml(absolute(base, defaultOf(versions)))}" />`
        ]
      : []),
    `<meta property="og:type" content="website" />`,
    `<meta property="og:url" content="${escapeHtml(absolute(base, page))}" />`,
    `<meta property="og:title" content="${escapeHtml(page.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(page.description)}" />`,
    `<meta property="og:locale" content="${page.lang}" />`,
    `<meta property="og:image" content="${escapeHtml(image)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta name="twitter:card" content="summary_large_image" />`
  ]
  return tags.join('\n    ')
}

export const pageHtml = (template: string, base: string, pages: PublicPage[], page: PublicPage) =>
  template
    .replace(/<html lang="[^"]*">/, `<html lang="${page.lang}">`)
    .replace(/<meta name="robots"[^>]*>/, '<meta name="robots" content="index, follow" />')
    .replace(/<title>[^<]*<\/title>/, headOf(base, pages, page))

// Robots may fetch everything a public page needs to draw (Hodi's scripts, the plugin's files, the calls a signed-out
// page makes): every other answer says noindex itself, so only the public pages reach a search engine.
export const robotsTxt = (base: string) =>
  ['User-agent: *', 'Allow: /', '', `Sitemap: ${base}/sitemap.xml`, ''].join('\n')

export const sitemapXml = (base: string, pages: PublicPage[]) => {
  const url = (page: PublicPage) => {
    const versions = siblings(pages, page)
    const alternates =
      versions.length > 1
        ? versions.map(
            other =>
              `<xhtml:link rel="alternate" hreflang="${other.lang}" href="${escapeHtml(absolute(base, other))}"/>`
          )
        : []
    return `  <url><loc>${escapeHtml(absolute(base, page))}</loc>${alternates.join('')}</url>`
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...pages.map(url),
    '</urlset>',
    ''
  ].join('\n')
}

const signedIn = (request: express.Request) =>
  (request.headers.cookie ?? '').split(';').some(part => part.trim().startsWith(`${SESSION_COOKIE}=`))

// Before the web app: the plugins' public pages with what search engines read, robots.txt and sitemap.xml. With no
// such page, or no address set, nothing changes: Hodi stays out of search engines.
export const servePublicPages = (app: express.Express, webDir: string, options: PublicPagesOptions) => {
  let template: string | null = null
  const indexHtml = () => (template ??= readFileSync(path.join(webDir, 'index.html'), 'utf8'))
  const indexed = () => {
    const base = options.appUrl()
    if (!base || !options.isOpen()) return null
    const pages = publicPagesOf(options.plugins.list(), options.plugins.enabled, hodiCard)
    return pages.length ? { base: base.replace(/\/+$/, ''), pages } : null
  }

  app.get(['/robots.txt', '/sitemap.xml'], (request, response, next) => {
    const site = indexed()
    if (!site) return next()
    response.set({ 'Cache-Control': 'public, max-age=3600', 'X-Robots-Tag': 'noindex' })
    if (request.path === '/robots.txt') response.type('text/plain').send(robotsTxt(site.base))
    else response.type('application/xml').send(sitemapXml(site.base, site.pages))
  })

  app.get('/{*page}', (request, response, next) => {
    if (signedIn(request)) return next()
    const site = indexed()
    const page = site?.pages.find(entry => entry.path === request.path)
    if (!site || !page) return next()
    response.set({ 'Cache-Control': 'no-cache', 'X-Robots-Tag': 'index, follow' })
    response.type('html').send(pageHtml(indexHtml(), site.base, site.pages, page))
  })
}
