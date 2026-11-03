import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { hashPassword, parsePasswordHash, verifyPassword } from '../auth/password.ts'

// Cheap parameters keep the suite fast; production uses DEFAULT_PARAMS.
const FAST = { N: 2 ** 10, r: 8, p: 1 }

describe('password hashing', () => {
  it('verifies the original password and rejects others', async () => {
    const encoded = await hashPassword('correct horse battery', FAST)

    assert.equal(await verifyPassword('correct horse battery', encoded), true)
    assert.equal(await verifyPassword('correct horse battery!', encoded), false)
  })

  it('uses a fresh salt for every hash', async () => {
    assert.notEqual(await hashPassword('same password', FAST), await hashPassword('same password', FAST))
  })

  it('produces a value without characters Docker Compose would interpolate', async () => {
    const encoded = await hashPassword('dollar $ sign', FAST)

    assert.match(encoded, /^scrypt:1024:8:1:[\w-]+:[\w-]+$/)
  })

  it('rejects malformed hashes', () => {
    assert.throws(() => parsePasswordHash('plain-text'))
    assert.throws(() => parsePasswordHash('scrypt:1000:8:1:abc:def'))
    assert.throws(() => parsePasswordHash(`scrypt:${2 ** 21}:8:1:abc:def`))
    assert.throws(() => parsePasswordHash('scrypt:1024:8:1:abc:tooshort'))
  })
})
