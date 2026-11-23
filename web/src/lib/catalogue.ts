import type { SourceProposal, SourceStatus, TopicInfo } from '../api.ts'
import { foldText } from '../../../shared/word-match.ts'

// The catalogue: every source of the server, those in the person's « Mes sources » and the others, and sources.yml's
// sources nobody added yet (the Officielles still to fetch).
export interface CatalogueEntry {
  id: string
  name: string
  site: string
  lang: 'fr' | 'en'
  description?: string
  readers?: number
  official: boolean
  topicIds: string[]
  // In « Mes sources ».
  mine: boolean
  // sources.yml's, not on the server yet: adding it fetches it for everyone.
  proposal: boolean
}

// Alphabétique (A → Z or Z → A), or by readers (most or fewest first).
export type CatalogueSort = 'az' | 'za' | 'popular' | 'unpopular'

export const CATALOGUE_SORTS: CatalogueSort[] = ['az', 'za', 'popular', 'unpopular']

interface CatalogueInput {
  sources: SourceStatus[]
  proposals: SourceProposal[]
  topics: TopicInfo[]
  hiddenSources: string[]
}

export const catalogueOf = ({ sources, proposals, topics, hiddenSources }: CatalogueInput): CatalogueEntry[] => {
  const topicIdsOf = (id: string) =>
    topics.filter(topic => topic.sources.some(source => source.id === id)).map(topic => topic.id)
  const followed = sources.map(source => ({
    id: source.id,
    name: source.name,
    site: source.site,
    lang: source.lang,
    ...(source.description ? { description: source.description } : {}),
    ...(source.readers ? { readers: source.readers } : {}),
    official: source.official === true,
    topicIds: topicIdsOf(source.id),
    mine: !hiddenSources.includes(source.id),
    proposal: false
  }))
  const offered = proposals
    .filter(proposal => !sources.some(source => source.id === proposal.id))
    .map(proposal => ({
      id: proposal.id,
      name: proposal.name,
      site: proposal.site,
      lang: proposal.lang,
      official: true,
      topicIds: [proposal.topicId],
      mine: false,
      proposal: true
    }))
  return [...followed, ...offered]
}

interface EntriesQuery {
  topicId: string
  language: string
  search?: string
  sort?: CatalogueSort
}

// A topic's sources, by name or by readers (then by name), those in « Mes sources » kept in their place. The search
// looks in the topic's, by name and description.
export const entriesOf = (entries: CatalogueEntry[], { topicId, language, search = '', sort = 'az' }: EntriesQuery) => {
  const wanted = foldText(search.trim())
  const shown = entries.filter(
    entry =>
      entry.topicIds.includes(topicId) &&
      (!wanted || foldText(`${entry.name} ${entry.description ?? ''}`).includes(wanted))
  )
  const byName = (a: CatalogueEntry, b: CatalogueEntry) => a.name.localeCompare(b.name, language)
  const byReaders = (a: CatalogueEntry, b: CatalogueEntry) => (a.readers ?? 0) - (b.readers ?? 0)
  const order: Record<CatalogueSort, (a: CatalogueEntry, b: CatalogueEntry) => number> = {
    az: byName,
    za: (a, b) => byName(b, a),
    popular: (a, b) => byReaders(b, a) || byName(a, b),
    unpopular: (a, b) => byReaders(a, b) || byName(a, b)
  }
  return [...shown].sort(order[sort])
}

// The topics the catalogue has sources in, in the topics' order.
export const partsOf = (entries: CatalogueEntry[], topics: TopicInfo[]) =>
  topics.filter(topic => entries.some(entry => entry.topicIds.includes(topic.id)))

// "35", "1,1 k" past a thousand.
export const readersCount = (count: number, language: string) =>
  new Intl.NumberFormat(language, { notation: 'compact', maximumFractionDigits: 1 }).format(count)
