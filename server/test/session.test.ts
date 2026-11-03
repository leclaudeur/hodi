import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createHmac } from 'node:crypto'
import { createSessionToken, readCookie, sessionCookie, sessionKey, verifySessionToken } from '../auth/session.ts'

const SECRET = Buffer.alloc(32, 7)
const NOW = Date.UTC(2026, 9, 23)

describe('session tokens', () => {
  it('accepts a fresh token signed with the same secret', () => {
    assert.equal(verifySessionToken(createSessionToken(SECRET, NOW), SECRET, NOW), true)
  })

  it('keeps the key of older sessions at generation 0 and changes it with each generation', () => {
    const before = createHmac('sha256', SECRET).update('session.hash').digest()
    assert.deepEqual(sessionKey(SECRET, 'hash'), before)
    assert.notDeepEqual(sessionKey(SECRET, 'hash', 1), before)
    assert.notDeepEqual(sessionKey(SECRET, 'hash', 2), sessionKey(SECRET, 'hash', 1))
  })

  it('rejects expired tokens', () => {
    const token = createSessionToken(SECRET, NOW, 60)

    assert.equal(verifySessionToken(token, SECRET, NOW + 61_000), false)
  })

  it('rejects tokens signed with another secret', () => {
    assert.equal(verifySessionToken(createSessionToken(Buffer.alloc(32, 8), NOW), SECRET, NOW), false)
  })

  it('rejects a token whose expiry was tampered with', () => {
    const [version, expiry, signature] = createSessionToken(SECRET, NOW, 60).split('.')
    const forged = `${version}.${Number(expiry) + 10_000_000}.${signature}`

    assert.equal(verifySessionToken(forged, SECRET, NOW), false)
  })

  it('rejects garbage', () => {
    for (const token of ['', 'v1', 'v1.abc.def', 'v2.1.x', '...']) {
      assert.equal(verifySessionToken(token, SECRET, NOW), false)
    }
  })
})

describe('cookies', () => {
  it('reads a named cookie from a header', () => {
    assert.equal(readCookie('a=1; hodi_session=abc.def; b=2', 'hodi_session'), 'abc.def')
    assert.equal(readCookie('a=1', 'hodi_session'), undefined)
    assert.equal(readCookie(undefined, 'hodi_session'), undefined)
  })

  it('sets a hardened session cookie', () => {
    const cookie = sessionCookie('token')

    for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=7776000']) {
      assert.ok(cookie.includes(attribute), `missing ${attribute}`)
    }
  })
})
