import { describe, expect, it } from 'vitest'
import type { TopicItem } from '../src/api.ts'
import { matchesWords, searchWords } from '../src/lib/find.ts'
import { highlightRanges } from '../src/lib/highlight.ts'

const marked = (text: string, words: string[]) =>
  highlightRanges(text, words).map(([start, end]) => text.slice(start, end))

describe('highlight', () => {
  it('marks the searched words in the text as written, accents included', () => {
    expect(marked('La Forêt brûle', ['foret'])).toEqual(['Forêt'])
    expect(marked('Élection et élections', ['election'])).toEqual(['Élection', 'élection'])
  })

  it('marks only at the start of a word', () => {
    expect(marked('via une IA', ['ia'])).toEqual(['IA'])
  })

  it('merges marks that overlap', () => {
    expect(highlightRanges('football', ['foot', 'football'])).toEqual([[0, 8]])
  })

  it('ignores empty words', () => {
    expect(highlightRanges('Bruxelles', ['', '  '])).toEqual([])
  })
})

describe('find', () => {
  const item = { title: 'Pluie sur Bruxelles', summary: 'Une journée grise', sourceName: 'RTL info' } as TopicItem

  it('splits a query into words', () => {
    expect(searchWords('  pluie   Bruxelles ')).toEqual(['pluie', 'Bruxelles'])
    expect(searchWords('   ')).toEqual([])
  })

  it('needs every word in the title, the summary or the source', () => {
    expect(matchesWords(item, ['pluie', 'grise'])).toBe(true)
    expect(matchesWords(item, ['rtl', 'bruxelles'])).toBe(true)
    expect(matchesWords(item, ['pluie', 'soleil'])).toBe(false)
  })
})
