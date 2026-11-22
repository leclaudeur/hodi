import { type Database, transaction } from './database.ts'

// The domains the server's admin blocked (« Bloquer » a source, for illegal content): no feed of theirs is added
// again, by anyone. Not a list kept apart from the sources: a source is in the catalogue, refused, or blocked.

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

// The host itself, or any of its subdomains: blocking rfi.fr blocks www.rfi.fr and podcasts.rfi.fr.
const isUnder = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`)

export class BlockedDomainStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  block(domain: string, now: number) {
    this.#db.prepare('INSERT OR IGNORE INTO blocked_domains (domain, at) VALUES (?, ?)').run(domain, now)
  }

  // false: it was not blocked.
  unblock(domain: string) {
    return this.#db.prepare('DELETE FROM blocked_domains WHERE domain = ?').run(domain).changes > 0
  }

  // The latest first.
  all(): BlockedDomain[] {
    return this.#db
      .prepare('SELECT domain, at FROM blocked_domains ORDER BY at DESC, domain')
      .all() as unknown as BlockedDomain[]
  }

  // Whether a source's feed or site is on a blocked domain.
  covers(source: { url: string; domains: string[] }) {
    const blocked = this.all().map(entry => entry.domain)
    if (blocked.length === 0) return false
    const hosts = [source.url, ...source.domains.map(domain => `https://${domain}/`)]
      .map(domainOf)
      .filter(host => host !== null)
    return hosts.some(host => blocked.some(domain => isUnder(host, domain)))
  }

  // A source blocked goes for good, on every account, with everything read of it: its articles with their texts and
  // pictures, the copies kept in Enregistrés, its readings. What points to the feed goes with its row.
  erase(sourceIds: string[]) {
    transaction(this.#db, () => {
      for (const id of sourceIds) {
        this.#db
          .prepare('DELETE FROM saved_articles WHERE article_id IN (SELECT id FROM articles WHERE source_id = ?)')
          .run(id)
        this.#db.prepare('DELETE FROM readings WHERE source_id = ?').run(id)
        this.#db.prepare('DELETE FROM articles WHERE source_id = ?').run(id)
        this.#db.prepare('DELETE FROM youth_sources WHERE source_id = ?').run(id)
        this.#db.prepare('DELETE FROM my_sources WHERE source_id = ?').run(id)
        this.#db.prepare('DELETE FROM source_icons WHERE source_id = ?').run(id)
        this.#db.prepare('DELETE FROM sources WHERE id = ?').run(id)
      }
    })
  }
}
