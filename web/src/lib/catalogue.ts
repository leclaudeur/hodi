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

// 'official': sources.yml's tab; otherwise a topic's id.
export type CataloguePart = 'official' | string

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

// A part's sources: the person's language first, then the most read, then by name. A search looks in every part.
export const entriesOf = (entries: CatalogueEntry[], part: CataloguePart, language: string, search = '') => {
  const wanted = foldText(search.trim())
  const shown = wanted
    ? entries.filter(entry => foldText(`${entry.name} ${entry.description ?? ''}`).includes(wanted))
    : entries.filter(entry => (part === 'official' ? entry.official : entry.topicIds.includes(part)))
  return [...shown].sort(
    (a, b) =>
      Number(b.lang === language) - Number(a.lang === language) ||
      (b.readers ?? 0) - (a.readers ?? 0) ||
      a.name.localeCompare(b.name, language)
  )
}

// The topics the catalogue has sources in, in the topics' order.
export const partsOf = (entries: CatalogueEntry[], topics: TopicInfo[]) =>
  topics.filter(topic => entries.some(entry => entry.topicIds.includes(topic.id)))

// "35", "1,1 k" past a thousand.
export const readersCount = (count: number, language: string) =>
  new Intl.NumberFormat(language, { notation: 'compact', maximumFractionDigits: 1 }).format(count)
