import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { guessLanguage } from '../news/language.ts'

describe('language guess', () => {
  it('tells a French title from an English one', () => {
    assert.equal(guessLanguage('Grève à la SNCB : les trains roulent peu ce lundi'), 'fr')
    assert.equal(guessLanguage('Think you can save the Hubble Space Telescope? NASA wants to know'), 'en')
    // Short and without the common words the older guess relied on.
    assert.equal(guessLanguage('Inondations meurtrières dans le sud-est espagnol'), 'fr')
    assert.equal(guessLanguage('Deadly floods hit southeastern Spain overnight'), 'en')
  })

  it('stays unsure without text', () => {
    assert.equal(guessLanguage(''), null)
    assert.equal(guessLanguage('2026'), null)
    // Too few words: one borrowed word could decide.
    assert.equal(guessLanguage('Élections Summary'), null)
  })
})
