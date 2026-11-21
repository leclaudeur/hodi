import { describe, expect, it } from 'vitest'
import type { SourceProposal, SourceStatus, TopicInfo } from '../src/api.ts'
import { catalogueOf, entriesOf, partsOf, readersCount } from '../src/lib/catalogue.ts'

const status = (id: string, extra: Partial<SourceStatus> = {}): SourceStatus => ({
  id,
  name: id.toUpperCase(),
  kind: 'article',
  lang: 'fr',
  site: `https://${id}.example/`,
  ok: true,
  itemCount: 3,
  fetchedAt: null,
  error: null,
  ...extra
})

const topics: TopicInfo[] = [
  { id: 'world', label: 'Monde', sources: [{ id: 'rtl' }, { id: 'bbc' }].map(s => ({ ...s, name: s.id })) },
  { id: 'tech', label: 'Tech', sources: [{ id: 'blog', name: 'blog', addedBy: 2 }] },
  { id: 'food', label: 'Cuisine', sources: [] }
]
const proposals: SourceProposal[] = [
  { id: 'rfi', name: 'RFI', topicId: 'world', lang: 'fr', site: 'https://rfi.example/' },
  // Already on the server: not offered twice.
  { id: 'rtl', name: 'RTL', topicId: 'world', lang: 'fr', site: 'https://rtl.example/' }
]
const entries = catalogueOf({
  sources: [
    status('rtl', { official: true, readers: 12 }),
    status('bbc', { official: true, lang: 'en', readers: 40 }),
    status('blog', { addedBy: 2, description: 'Le blog d’une cuisinière' })
  ],
  proposals,
  topics,
  hiddenSources: ['bbc']
})

describe('the catalogue', () => {
  it('holds the server’s sources, in « Mes sources » or not, and sources.yml’s still to fetch', () => {
    expect(entries.map(entry => [entry.id, entry.mine, entry.official, entry.proposal])).toEqual([
      ['rtl', true, true, false],
      ['bbc', false, true, false],
      ['blog', true, false, false],
      ['rfi', false, true, true]
    ])
    expect(entries.find(entry => entry.id === 'rfi')?.topicIds).toEqual(['world'])
  })

  const ids = (query: Parameters<typeof entriesOf>[1]) => entriesOf(entries, query).map(entry => entry.id)

  it('lists a topic’s sources by name, A to Z by default', () => {
    expect(ids({ topicId: 'world', language: 'fr' })).toEqual(['bbc', 'rfi', 'rtl'])
    expect(ids({ topicId: 'world', language: 'fr', sort: 'za' })).toEqual(['rtl', 'rfi', 'bbc'])
    expect(ids({ topicId: 'tech', language: 'fr' })).toEqual(['blog'])
  })

  it('lists them by readers, then by name', () => {
    expect(ids({ topicId: 'world', language: 'fr', sort: 'popular' })).toEqual(['bbc', 'rtl', 'rfi'])
    expect(ids({ topicId: 'world', language: 'fr', sort: 'unpopular' })).toEqual(['rfi', 'rtl', 'bbc'])
  })

  it('searches the topic’s sources only, by name and description', () => {
    expect(ids({ topicId: 'tech', language: 'fr', search: 'cuisiniere' })).toEqual(['blog'])
    expect(ids({ topicId: 'world', language: 'fr', search: 'cuisiniere' })).toEqual([])
  })

  it('shows only the topics it has sources in', () => {
    expect(partsOf(entries, topics).map(topic => topic.id)).toEqual(['world', 'tech'])
  })

  it('writes a count of readers short', () => {
    expect(readersCount(35, 'fr')).toBe('35')
    expect(readersCount(1100, 'fr')).toBe('1,1 k')
  })
})
