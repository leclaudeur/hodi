import type { FeedItem } from './feed-parser.ts'
import { foldText, wordPattern } from '../../shared/word-match.ts'

// What a profile turned off: its hidden sources and topics, and its muted words.
export interface ReaderFilter {
  hiddenSources: string[]
  hiddenTopics: string[]
  mutedWords: string[]
}

export const NO_FILTER: ReaderFilter = { hiddenSources: [], hiddenTopics: [], mutedWords: [] }

// The filter in a profile's stored preferences.
export const readerFilterOf = (preferences: Record<string, unknown> | null): ReaderFilter => {
  const strings = (value: unknown) =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
  return {
    hiddenSources: strings(preferences?.hiddenSources),
    hiddenTopics: strings(preferences?.hiddenTopics),
    mutedWords: strings(preferences?.mutedWords)
  }
}

// The reader's filter as one test: true for an article the profile does not want to see.
export const filtered = ({ hiddenSources, mutedWords }: ReaderFilter) => {
  const muted = mutedWords.map(wordPattern)
  return (item: Pick<FeedItem, 'sourceId' | 'title' | 'summary'>) =>
    hiddenSources.includes(item.sourceId) ||
    (muted.length > 0 && muted.some(pattern => pattern.test(foldText(`${item.title} ${item.summary}`))))
}
