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

  it('lists a part in the person’s language first, then the most read', () => {
    expect(entriesOf(entries, 'official', 'fr').map(entry => entry.id)).toEqual(['rtl', 'rfi', 'bbc'])
    expect(entriesOf(entries, 'official', 'en').map(entry => entry.id)).toEqual(['bbc', 'rtl', 'rfi'])
    expect(entriesOf(entries, 'tech', 'fr').map(entry => entry.id)).toEqual(['blog'])
  })

  it('searches every part, by name and description', () => {
    expect(entriesOf(entries, 'official', 'fr', 'cuisiniere').map(entry => entry.id)).toEqual(['blog'])
  })

  it('shows only the topics it has sources in', () => {
    expect(partsOf(entries, topics).map(topic => topic.id)).toEqual(['world', 'tech'])
  })

  it('writes a count of readers short', () => {
    expect(readersCount(35, 'fr')).toBe('35')
    expect(readersCount(1100, 'fr')).toBe('1,1 k')
  })
})
