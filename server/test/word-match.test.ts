import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { foldText, wordPattern } from '../news/word-match.ts'

const finds = (word: string, text: string) => wordPattern(word).test(foldText(text))

describe('wordPattern', () => {
  it('finds words at their start, ignoring case and accents', () => {
    assert.equal(finds('foot', 'Le Football belge'), true)
    assert.equal(finds('election', 'Les élections de dimanche'), true)
    assert.equal(finds('IA', 'Passé via Bruxelles'), false)
  })

  it('keeps numbers whole', () => {
    assert.equal(finds('GTA 6', 'GTA 6 : la date de sortie'), true)
    assert.equal(finds('GTA 6', 'Les bons plans du 24/10/2026 sur GTA'), false)
    assert.equal(finds('GTA 6', 'GTA 64 sur console'), false)
    assert.equal(finds('6', 'Le 24/10/2026'), false)
    assert.equal(finds('2026', 'Le budget 2026'), true)
  })

  it('finds a numbered name in Roman numerals too', () => {
    assert.equal(finds('GTA 6', 'Ce PC est prêt pour GTA VI'), true)
    assert.equal(finds('GTA 6', 'GTA vidéo'), false)
    assert.equal(finds('Rocky 2', 'Rocky II revient'), true)
  })
})
