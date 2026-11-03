import { describe, expect, it } from 'vitest'
import * as server from '../../server/news/word-match.ts'
import { foldText, wordPattern } from '../src/lib/word-match.ts'

const finds = (word: string, text: string) => wordPattern(word).test(foldText(text))

describe('word match', () => {
  it('compares words without accents or case', () => {
    expect(foldText('Forêt Éléphant ÇA')).toBe('foret elephant ca')
    expect(finds('foret', 'La Forêt de Soignes')).toBe(true)
  })

  it('finds a word at the start of a word only', () => {
    expect(finds('foot', 'Le football belge')).toBe(true)
    expect(finds('IA', 'Une IA générative')).toBe(true)
    expect(finds('IA', 'Envoyé via la poste')).toBe(false)
  })

  it('keeps a number whole, and finds it in Roman numerals after a name', () => {
    expect(finds('6', 'En 2026')).toBe(false)
    expect(finds('GTA 6', 'GTA VI sort enfin')).toBe(true)
    expect(finds('GTA 6', 'GTA 6 sort enfin')).toBe(true)
    expect(finds('GTA 6', 'GTA 60')).toBe(false)
  })

  it('treats a searched word as text, not as a pattern', () => {
    expect(finds('c++', 'Apprendre le C++')).toBe(true)
    expect(finds('a.b', 'axb')).toBe(false)
  })

  // The search runs on the server, the marks in the browser: both must find the same words.
  it('matches like the server', () => {
    const cases: [string, string][] = [
      ['foret', 'La Forêt'],
      ['IA', 'via'],
      ['GTA 6', 'GTA VI'],
      ['6', '2026'],
      ['élection', 'Les élections communales'],
      ['c++', 'Le C++ moderne']
    ]
    for (const [word, text] of cases) {
      expect(finds(word, text)).toBe(server.wordPattern(word).test(server.foldText(text)))
    }
  })
})
