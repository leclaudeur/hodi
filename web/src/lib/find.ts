import type { TopicItem } from '../api.ts'
import { highlightRanges } from './highlight.ts'

// Whether an article holds every searched word in its title, summary or source, compared like the search: without
// accents or case, at the start of a word.
export const matchesWords = (item: TopicItem, words: string[]) => {
  const text = [item.title, item.summary, item.sourceName].join(' ')
  return words.every(word => highlightRanges(text, [word]).length > 0)
}

export const searchWords = (query: string) => query.trim().split(/\s+/).filter(Boolean)
