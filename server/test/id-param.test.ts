import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { idParam } from '../http/id-param.ts'

describe('a number in an address', () => {
  it('reads one written plainly', () => {
    assert.equal(idParam('2'), 2)
    assert.equal(idParam('0042'), 42)
  })

  it('names no row when written any other way', () => {
    for (const value of ['2.0', '0x2', '2e0', '+2', ' 2', '-2', '', 'current', '9999999999999999', undefined]) {
      assert.ok(Number.isNaN(idParam(value)), String(value))
    }
  })
})
