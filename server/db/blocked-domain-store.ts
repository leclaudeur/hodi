import { type Database, transaction } from './database.ts'

// The sites the server's admin blocked (« Bloquer » a source, for illegal content): no feed of theirs is added again, by
// anyone. Not a list kept apart from the sources: a source is in the catalogue, refused, or blocked.

export interface BlockedDomain {
  domain: string
  at: number
}

// A site's domain, as it is blocked: its host without « www. ».
export const domainOf = (link: string) => {
  try {
    return new URL(link).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

// Hosts that carry the feeds of many unrelated people: blocking one of their sources blocks that feed alone, never
// the whole host (a YouTube channel, not YouTube).
const SHARED_HOSTS = [
  'youtube.com',
  'medium.com',
  'substack.com',
  'feedburner.com',
  'blogspot.com',
  'wordpress.com',
  'tumblr.com',
  'github.io',
  'reddit.com',
  'google.com',
  'apple.com',
  'spotify.com',
  'soundcloud.com',
  'anchor.fm',
  'podbean.com',
  'libsyn.com',
  'buzzsprout.com',
  'acast.com',
  'ausha.co',
  'rss.app',
  'feedly.com'
]

// The host itself, or any of its subdomains: blocking rfi.fr blocks www.rfi.fr and podcasts.rfi.fr.
const isUnder = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`)

// What blocking a source blocks: its site's domain, or on a shared host its feed's exact address.
// A feed's address as blocked, so the same feed typed another way is the same one: no scheme, no « www. » or « m. »,
// no trailing « / » or fragment, its query sorted; a YouTube feed by its channel or playlist alone.
export const feedKeyOf = (link: string) => {
  try {
    const url = new URL(link)
    const host = url.hostname.toLowerCase().replace(/^(www|m)\./, '')
    if (isUnder(host, 'youtube.com'))
      for (const key of ['channel_id', 'playlist_id', 'user']) {
        const value = url.searchParams.get(key)
        if (value) return `youtube.com/${key}=${value}`
      }
    const query = [...url.searchParams]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('&')
    return `${host}${url.pathname.replace(/\/+$/, '')}${query ? `?${query}` : ''}`
  } catch {
    return null
  }
}

export const blockTargetOf = (source: { url: string; domains: string[] }) => {
  const host = domainOf(source.domains[0] ? `https://${source.domains[0]}/` : source.url)
  if (!host) return null
  return SHARED_HOSTS.some(shared => isUnder(host, shared)) ? feedKeyOf(source.url) : host
}

// An entry is a domain, or a feed's key (with its « / »).
export const coversTarget = (entry: string, source: { url: string; domains: string[] }) => {
  if (entry.includes('/')) return feedKeyOf(source.url) === entry
  const hosts = [source.url, ...source.domains.map(domain => `https://${domain}/`)].map(domainOf)
  return hosts.some(host => host !== null && isUnder(host, entry))
}

export class BlockedDomainStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  block(target: string, now: number) {
    this.#db.prepare('INSERT OR IGNORE INTO blocked_domains (domain, at) VALUES (?, ?)').run(target, now)
  }

  // false: it was not blocked.
  unblock(target: string) {
    return this.#db.prepare('DELETE FROM blocked_domains WHERE domain = ?').run(target).changes > 0
  }

  // The latest first.
  all(): BlockedDomain[] {
    return this.#db
      .prepare('SELECT domain, at FROM blocked_domains ORDER BY at DESC, domain')
      .all() as unknown as BlockedDomain[]
  }

  // Whether a source's feed or site is blocked.
  covers(source: { url: string; domains: string[] }) {
    return this.all().some(entry => coversTarget(entry.domain, source))
  }

  // A source blocked goes for good, on every account, with everything read of it: its articles with their texts and
  // pictures, the copies kept in Enregistrés and Partages, its readings, a teen's requests for it. What points to the
  // feed goes with its row. The game's points stay: they hold only an id.
  erase(sources: { id: string; url: string }[]) {
    transaction(this.#db, () => {
      for (const { id } of sources) {
        const ofSource = 'IN (SELECT id FROM articles WHERE source_id = ?)'
        for (const table of ['saved_articles', 'shares', 'read_articles', 'seen_stories'])
          this.#db.prepare(`DELETE FROM ${table} WHERE article_id ${ofSource}`).run(id)
        this.#db.prepare('DELETE FROM readings WHERE source_id = ?').run(id)
        this.#db.prepare('DELETE FROM articles WHERE source_id = ?').run(id)
        this.#db.prepare('DELETE FROM youth_sources WHERE source_id = ?').run(id)
        this.#db.prepare('DELETE FROM my_sources WHERE source_id = ?').run(id)
        this.#db.prepare('DELETE FROM source_icons WHERE source_id = ?').run(id)
        this.#db.prepare('DELETE FROM sources WHERE id = ?').run(id)
      }
      this.#forgetRequests()
    })
  }

  // A teen's requests for a blocked site, answered or not: they hold its name and address.
  #forgetRequests() {
    const requests = this.#db.prepare('SELECT id, source FROM source_requests').all() as {
      id: number
      source: string
    }[]
    for (const request of requests) {
      const asked = JSON.parse(request.source) as { url?: unknown; domains?: unknown }
      const source = {
        url: typeof asked.url === 'string' ? asked.url : '',
        domains: Array.isArray(asked.domains) ? asked.domains.filter(domain => typeof domain === 'string') : []
      }
      if (this.covers(source)) this.#db.prepare('DELETE FROM source_requests WHERE id = ?').run(request.id)
    }
  }
}
