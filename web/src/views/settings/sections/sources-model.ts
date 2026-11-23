import type { SourceStatus, TopicInfo } from '../../../api.ts'
import { getLanguage } from '../../../lib/i18n.ts'
import { sourceState } from '../../../lib/settings-data.ts'
import { foldText } from '../../../../../shared/word-match.ts'
import type { SourceFilter } from './SourceFilters.tsx'

// A source's site as its row's line: "lejde.be".
export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export const topicsOfSource = (topics: TopicInfo[], sourceId: string) =>
  topics.filter(topic => topic.sources.some(source => source.id === sourceId))

interface FilterInput {
  sources: SourceStatus[] | null | undefined
  topics: TopicInfo[]
  hiddenSources: string[]
  engagement: { sources: { id: string; low?: boolean }[] } | null | undefined
  search: string
  filter: SourceFilter
  topicFilter: string[]
}

// The sources the search, the state filter and the topic filter keep, with what the toolbar shows about them.
export const filterSources = ({
  sources,
  topics,
  hiddenSources,
  engagement,
  search,
  filter,
  topicFilter
}: FilterInput) => {
  const topicsOf = (sourceId: string) => topicsOfSource(topics, sourceId)
  const hidden = (id: string) => hiddenSources.includes(id)
  const lowOf = (id: string) => {
    const row = engagement?.sources.find(candidate => candidate.id === id)
    return row?.low && !hidden(id) ? row : null
  }
  const matches: Record<SourceFilter, (source: SourceStatus) => boolean> = {
    all: () => true,
    low: source => lowOf(source.id) !== null,
    error: source => sourceState(source) === 'error' && !hidden(source.id)
  }
  const counts = sources && {
    all: sources.length,
    low: sources.filter(matches.low).length,
    error: sources.filter(matches.error).length
  }
  const chosen = filter !== 'all' && counts?.[filter] === 0 ? 'all' : filter
  // The topics with at least one source, in the topics' order.
  const filterTopics = topics.filter(topic => topic.sources.length > 0)
  const chosenTopics = topicFilter.filter(id => filterTopics.some(topic => topic.id === id))
  const wanted = foldText(search.trim())
  const shown = (sources ?? []).filter(
    source =>
      matches[chosen](source) &&
      (chosenTopics.length === 0 || topicsOf(source.id).some(topic => chosenTopics.includes(topic.id))) &&
      (!wanted ||
        foldText(
          `${source.name} ${topicsOf(source.id)
            .map(topic => topic.label)
            .join(' ')}`
        ).includes(wanted))
  )
  return { topicsOf, hidden, lowOf, counts, chosen, filterTopics, chosenTopics, wanted, shown }
}

// Mes sources' two grids: the base ones, then every other the account reads (its own, its channels, those another
// account added), each by name.
export const gridsOf = (shown: SourceStatus[]) => {
  const byName = (a: SourceStatus, b: SourceStatus) => a.name.localeCompare(b.name, getLanguage())
  return {
    base: shown.filter(source => source.addedBy === undefined).sort(byName),
    mine: shown.filter(source => source.addedBy !== undefined).sort(byName)
  }
}
