import type { TopicItem } from './news-types.ts'

// "À la une": the stories a topic puts forward.

const FRONT_PAGE_SIZE = 3

interface FrontOptions {
  hidden: (item: TopicItem) => boolean
  // From the last day when there are enough.
  recent: string
  known: ReadonlySet<string>
}

// A story the profile already knows, by any of its articles, makes room for the next one; it comes back only when
// the topic has nothing newer.
export const frontSection = (listed: TopicItem[], { hidden, recent, known }: FrontOptions) => {
  const isKnown = (item: TopicItem) => known.has(item.id) || item.related.some(other => known.has(other.id))
  const items = listed.filter(item => !hidden(item))
  const fresh = items.filter(item => item.publishedAt !== null && item.publishedAt >= recent)
  // More sources on a story means a bigger story; the newest first among equals.
  const ranked = (fresh.length >= FRONT_PAGE_SIZE ? fresh : items)
    .map((item, index) => ({ item, index }))
    .sort((a, b) => b.item.related.length - a.item.related.length || a.index - b.index)
    .map(({ item }) => item)
  return [...ranked.filter(item => !isKnown(item)), ...ranked.filter(isKnown)].slice(0, FRONT_PAGE_SIZE)
}
