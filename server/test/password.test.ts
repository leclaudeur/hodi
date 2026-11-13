import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_PARAMS,
  MAX_RUNNING,
  hashPassword,
  mostRunningChecks,
  needsRehash,
  parsePasswordHash,
  verifyPassword
} from '../auth/password.ts'

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

  it('uses a scrypt setting OWASP recommends, and knows older hashes', async () => {
    assert.deepEqual(DEFAULT_PARAMS, { N: 2 ** 15, r: 8, p: 3 })
    // 32 MiB a check: two at once fit well in the container's 256 MiB.
    assert.equal(128 * DEFAULT_PARAMS.N * DEFAULT_PARAMS.r, 32 * 1024 * 1024)
    const old = await hashPassword('correct horse battery', FAST)
    assert.equal(needsRehash(old), true)
    assert.equal(needsRehash(old, FAST), false)
    assert.equal(needsRehash(`scrypt:${2 ** 15}:8:1:${old.split(':')[4]}:${old.split(':')[5]}`), true)
  })

  it('runs two checks at once at most, however many are asked', async () => {
    const hashes = await Promise.all(Array.from({ length: 8 }, (_, index) => hashPassword(`password ${index}`, FAST)))
    assert.equal(hashes.length, 8)
    assert.equal(MAX_RUNNING, 2)
    assert.ok(mostRunningChecks() <= MAX_RUNNING)
    assert.ok(mostRunningChecks() >= 1)
  })
})
