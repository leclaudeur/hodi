import path from 'node:path'
import { loadConfig } from '../server/config.ts'
import type { FetchText } from '../server/news/fetch-text.ts'
import { startHodi } from '../server/start.ts'

// Hodi as it runs for real, built web app included, except that the sites it reads are these pages: the tests never
// depend on the internet or on what a news site published today.

const HOUR = 60 * 60 * 1000

// Long enough for the reader to keep it (short pages are hidden as not readable).
const body = (title: string, paragraphs = 8) =>
  Array.from(
    { length: paragraphs },
    (_, index) =>
      `<p>${title}, paragraphe ${index + 1}. La rédaction a suivi la journée de près et revient sur ce qui s’est passé, ` +
      'avec les réactions des habitants, des commerçants et des élus, et ce qui est prévu pour la suite.</p>'
  ).join('')

const articles = [
  { site: 'alpha', slug: 'pluie', title: 'Pluie record sur Bruxelles', hoursAgo: 1 },
  { site: 'alpha', slug: 'tram', title: 'Le nouveau tram arrive à Liège', hoursAgo: 2 },
  // Long enough to be left half read, for « Reprendre ».
  { site: 'alpha', slug: 'dossier', title: 'Le grand dossier de l’hiver', hoursAgo: 7, paragraphs: 60 },
  { site: 'beta', slug: 'bourse', title: 'La bourse de Paris recule', hoursAgo: 3 },
  // Sites that are not sources yet: a profile adds the first, a teen asks for the two others.
  { site: 'gamma', slug: 'velo', title: 'Le vélo gagne du terrain à Namur', hoursAgo: 4 },
  { site: 'delta', slug: 'foot', title: 'Victoire des Diables rouges', hoursAgo: 5 },
  { site: 'epsilon', slug: 'jeux', title: 'Un nouveau jeu vidéo belge', hoursAgo: 6 }
]

// A site's home page names its feed, as most do.
const home = (site: string) =>
  `<!doctype html><html lang="fr"><head><title>${site}</title>` +
  `<link rel="alternate" type="application/rss+xml" href="/feed"></head><body><h1>${site}</h1></body></html>`

const page = (title: string, paragraphs?: number) =>
  `<!doctype html><html lang="fr"><head><title>${title}</title></head><body><main><article><h1>${title}</h1>` +
  `${body(title, paragraphs)}</article></main></body></html>`

const feed = (site: string) => {
  const items = articles
    .filter(article => article.site === site)
    .map(
      article =>
        `<item><title>${article.title}</title><link>https://${site}.example/${article.slug}</link>` +
        `<pubDate>${new Date(Date.now() - article.hoursAgo * HOUR).toUTCString()}</pubDate>` +
        `<description>${article.title}, le résumé.</description></item>`
    )
    .join('')
  const name = site[0]?.toUpperCase() + site.slice(1)
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>${name}</title><language>fr</language><link>https://${site}.example/</link>${items}</channel></rss>`
}

const fetchText: FetchText = async url => {
  const { hostname, pathname } = new URL(url)
  const site = hostname.replace(/\.example$/, '')
  if (pathname === '/feed') return { url, text: feed(site) }
  if (pathname === '/') return { url, text: home(site) }
  const article = articles.find(other => other.site === site && `/${other.slug}` === pathname)
  if (article) return { url, text: page(article.title, article.paragraphs) }
  throw new Error('HTTP 404')
}

const nothing = async () => {
  throw new Error('HTTP 404')
}

startHodi(
  loadConfig({
    ...process.env,
    SOURCES_FILE: path.resolve(import.meta.dirname, 'sources.yml'),
    WEB_DIR: path.resolve(import.meta.dirname, '../dist/web')
  }),
  {
    fetchText,
    findFetchText: fetchText,
    fetchBytes: nothing,
    fetchPictures: nothing,
    // The made-up sites, in place of the public addresses only a pasted link may use.
    isPublicLink: async url => url.protocol === 'https:' && url.hostname.endsWith('.example'),
    fetchVideoDuration: async () => null,
    sendPush: async () => {}
  }
)
