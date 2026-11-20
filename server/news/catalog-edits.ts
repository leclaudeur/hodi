import type { Catalog, Source, Topic } from './catalog.ts'

// A household's catalogue changed from Sources: the in-memory lists the feeds and topics are read from.

// A source added: listed with its topics (or its section of "Vidéos") from now on. False when one is unknown.
export const addToCatalog = (catalog: Catalog, source: Source, section: 'topic' | 'listen', sectionIds: string[]) => {
  const groups: { id: string; sources: Source[] }[] = section === 'topic' ? catalog.topics : catalog.listen
  const targets = sectionIds.map(id => groups.find(candidate => candidate.id === id))
  if (targets.length === 0 || targets.some(target => !target) || (section === 'listen' && targets.length > 1)) {
    return false
  }
  targets.forEach(target => target!.sources.push(source))
  return true
}

// A source moved to other topics: the first one labels its articles. False when one is unknown.
export const moveToTopics = (catalog: Catalog, sourceId: string, topicIds: string[]) => {
  const source = catalog.topics.flatMap(topic => topic.sources).find(candidate => candidate.id === sourceId)
  const topics = topicIds.map(id => catalog.topics.find(topic => topic.id === id))
  if (!source || topics.length === 0 || topics.some(topic => !topic)) return false
  for (const topic of catalog.topics) {
    topic.sources = topic.sources.filter(candidate => candidate.id !== sourceId)
  }
  // The first topic first: NewsSearch.topicOf finds it there.
  const [first, ...rest] = topics as Topic[]
  first!.sources.unshift(source)
  rest.forEach(topic => topic.sources.push(source))
  return true
}

export const removeFromCatalog = (catalog: Catalog, sourceId: string) => {
  for (const group of [...catalog.topics, ...catalog.listen]) {
    group.sources = group.sources.filter(source => source.id !== sourceId)
  }
}
