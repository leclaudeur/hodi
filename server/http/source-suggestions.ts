import type { SourceStore } from '../db/source-store.ts'
import type { NewsService } from '../news/news-service.ts'
import type { FindResult } from '../news/source-finder.ts'

interface SuggestedSite {
  url: string
  reason: string
}

// The sites the AI named for "Suggérer des sources" that Hodi can add: a feed found and tried in the reader, not
// followed yet.
export const newSuggestions = async (
  { news, sources }: { news: NewsService; sources: SourceStore },
  sites: SuggestedSite[],
  lookUp: (link: string) => Promise<FindResult>
) => {
  // A site already in the catalogue, by its domain (feeds.lesoir.be is lesoir.be), is not offered again.
  const hostOf = (link: string) => {
    try {
      return new URL(link).hostname.toLowerCase().split('.').slice(-2).join('.')
    } catch {
      return null
    }
  }
  const followedHosts = new Set(
    [...news.catalog.topics, ...news.catalog.listen].flatMap(section =>
      section.sources.flatMap(source =>
        [hostOf(source.url), ...source.domains.map(hostOf)].filter(host => host !== null)
      )
    )
  )
  const checked = await Promise.all(
    sites
      .filter(site => !followedHosts.has(hostOf(site.url) ?? ''))
      .map(async site => ({ site, found: await lookUp(site.url) }))
  )
  return checked.flatMap(({ site, found }) =>
    found.status === 'ok' &&
    found.source.kind === 'article' &&
    !sources.findByUrl(found.source.url) &&
    !followedHosts.has(hostOf(found.source.url) ?? '')
      ? [{ link: site.url, reason: site.reason, source: found.source }]
      : []
  )
}
