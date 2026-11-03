import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parsePreferences } from '../http/user-routes.ts'

describe('preferences body', () => {
  it('keeps known keys of the right type and drops the rest', () => {
    assert.deepEqual(parsePreferences({ textSize: 4, mutedSharers: [2, 3], language: null, junk: true }), {
      textSize: 4,
      mutedSharers: [2, 3],
      language: null
    })
  })

  it('refuses the whole body when one key is wrong', () => {
    for (const body of [
      { textSize: 5 },
      { textSize: 1.5 },
      { mutedSharers: [0] },
      { mutedWords: [''] },
      { mutedWords: null },
      { hideRead: 'yes' },
      { accent: 'noir' },
      [],
      null
    ]) {
      assert.equal(parsePreferences(body), null, JSON.stringify(body))
    }
  })
})
