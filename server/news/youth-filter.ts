import type { FeedItem } from './feed-parser.ts'
import type { DayFeed, ListenFeed, SearchResult, TopicFeed } from './news-types.ts'

// What a young profile may not see, whatever its devices ask: the sources and themes its parents did not turn on
// (YouthSources.lock). The web app hides them too, but the API is the boundary: a teen can open /api/search in the
// address bar.
export interface YouthLock {
  hiddenSources: string[]
  hiddenTopics: string[]
}

export const youthFilter = (lock: YouthLock) => {
  const sources = new Set(lock.hiddenSources)
  const topics = new Set(lock.hiddenTopics)
  const shown = (item: Pick<FeedItem, 'sourceId'>) => !sources.has(item.sourceId)
  // An article's "Aussi sur" cards from other sources go too.
  const withRelated = <T extends Pick<FeedItem, 'sourceId'> & { related: { sourceId: string }[] }>(item: T): T => ({
    ...item,
    related: item.related.filter(shown)
  })
  const listed = <T extends Pick<FeedItem, 'sourceId'> & { related: { sourceId: string }[]; topicId: string }>(
    items: T[]
  ) => items.filter(item => shown(item) && !topics.has(item.topicId)).map(withRelated)

  return {
    shown,
    topicShown: (topicId: string) => !topics.has(topicId),
    day: (feed: DayFeed): DayFeed => ({ ...feed, items: listed(feed.items) }),
    search: (result: SearchResult): SearchResult => ({ ...result, items: listed(result.items) }),
    topic: (feed: TopicFeed): TopicFeed => ({
      ...feed,
      items: feed.items.filter(shown).map(withRelated),
      sources: feed.sources.filter(source => !sources.has(source.id))
    }),
    listen: (feed: ListenFeed): ListenFeed => ({
      sections: feed.sections.map(section => ({ ...section, items: section.items.filter(shown) })),
      sources: feed.sources.filter(source => !sources.has(source.id))
    })
  }
}
