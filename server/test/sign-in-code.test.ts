import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { openDatabase } from '../db/database.ts'
import { SIGN_IN_CODE_ALPHABET, SignInCodeStore, drawCode, signInCodeOf } from '../db/sign-in-code-store.ts'

describe('codes of « J’ai un code »', () => {
  it('draws eight characters of the alphabet, as the setup code is too', () => {
    const drawn = new Set(Array.from({ length: 200 }, drawCode))
    assert.equal(drawn.size, 200)
    for (const code of drawn) assert.equal(signInCodeOf(code), code)
  })

  it('draws eight characters, none that reads like another', () => {
    const codes = new SignInCodeStore(openDatabase(':memory:'), Buffer.alloc(32, 1))
    const drawn = Array.from({ length: 200 }, (_, index) => codes.create({ createdBy: null }, index).code)
    for (const code of drawn) assert.match(code, /^[A-HJKMNP-Z2-9]{8}$/)
    assert.equal(new Set(drawn).size, drawn.length)
    assert.ok(!/[01ILO]/.test(SIGN_IN_CODE_ALPHABET))
    // Every character comes up: the draw covers the whole alphabet.
    assert.equal(new Set(drawn.join('')).size, SIGN_IN_CODE_ALPHABET.length)
  })

  it('reads a code as typed, in capitals and without spaces or dashes', () => {
    assert.equal(signInCodeOf('abcd-2345'), 'ABCD2345')
    assert.equal(signInCodeOf(' ABCD 2345 '), 'ABCD2345')
    for (const wrong of [
      '123456',
      'ABCD234',
      'ABCD23456',
      'ABCD234O',
      'ABCD2341',
      '',
      'ABCD;234',
      null,
      12345678,
      {}
    ]) {
      assert.equal(signInCodeOf(wrong), null, String(wrong))
    }
    assert.equal(signInCodeOf(`${' '.repeat(40)}ABCD2345`), null)
  })
})
