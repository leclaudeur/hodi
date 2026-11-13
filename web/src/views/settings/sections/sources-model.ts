import type { TFunction } from 'i18next'
import type { SourceStatus, TopicInfo } from '../../../api.ts'
import { getLanguage } from '../../../lib/i18n.ts'
import { sourceState } from '../../../lib/settings-data.ts'
import { foldText } from '../../../../../shared/word-match.ts'
import type { SourceFilter } from './SourceFilters.tsx'

export type GroupId = 'requests' | 'mine' | 'channels' | 'household' | 'base'

export interface SourceGroup {
  id: GroupId
  title: string
  sources: SourceStatus[]
}

export interface SourceSection {
  id: string
  label: string
  sources: SourceStatus[]
}

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
    error: source => sourceState(source) === 'error' && !hidden(source.id),
    hidden: source => hidden(source.id)
  }
  const counts = sources && {
    all: sources.length,
    low: sources.filter(matches.low).length,
    error: sources.filter(matches.error).length,
    hidden: sources.filter(matches.hidden).length
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

interface SectionInput {
  topics: TopicInfo[]
  chosenTopics: string[]
  placedOff: (id: string) => boolean
  t: TFunction
}

// A group's sources under a separator per topic, as Le fil's days: each under its first topic (the first filtered
// on, if any), in the topics' order, then those without one (channels) by kind, by name with the hidden ones last.
export const sectionsOf = (list: SourceStatus[], { topics, chosenTopics, placedOff, t }: SectionInput) => {
  const sections: SourceSection[] = []
  for (const source of list) {
    const tagged = topicsOfSource(topics, source.id)
    const topic = tagged.find(candidate => chosenTopics.includes(candidate.id)) ?? tagged[0]
    const id = topic?.id ?? source.kind
    const section = sections.find(candidate => candidate.id === id)
    if (section) section.sources.push(source)
    else sections.push({ id, label: topic?.label ?? t(`sources.kinds.${source.kind}`), sources: [source] })
  }
  const rank = (id: string) => {
    const index = topics.findIndex(topic => topic.id === id)
    return index === -1 ? topics.length : index
  }
  sections.sort((a, b) => rank(a.id) - rank(b.id))
  sections.forEach(section =>
    section.sources.sort(
      (a, b) => Number(placedOff(a.id)) - Number(placedOff(b.id)) || a.name.localeCompare(b.name, getLanguage())
    )
  )
  return sections
}

// The profile's own sites and channels, the household's, the base ones.
export const groupsOf = (shown: SourceStatus[], current: number | null | undefined, young: boolean, t: TFunction) => {
  const own = (source: SourceStatus) => source.addedBy !== undefined && source.addedBy === current
  const groups: SourceGroup[] = [
    {
      id: 'mine',
      title: t('sources.groups.mine'),
      sources: shown.filter(source => own(source) && source.kind === 'article')
    },
    {
      id: 'channels',
      title: t('sources.groups.channels'),
      sources: shown.filter(source => own(source) && source.kind !== 'article')
    },
    {
      id: 'household',
      title: young ? t('requests.byParents') : t('sources.groups.household'),
      sources: shown.filter(source => source.addedBy !== undefined && source.addedBy !== current)
    },
    { id: 'base', title: t('sources.groups.base'), sources: shown.filter(source => source.addedBy === undefined) }
  ]
  return groups
}
