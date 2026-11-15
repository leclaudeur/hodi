import { createHmac } from 'node:crypto'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createSessionToken,
  createUserSessionToken,
  readCookie,
  sessionCookie,
  userIdOfToken,
  userSessionKey,
  verifySessionToken,
  verifyUserSessionToken
} from '../auth/session.ts'

const SECRET = Buffer.alloc(32, 7)
const NOW = Date.UTC(2026, 9, 23)

describe('session tokens', () => {
  it('accepts a fresh token signed with the same secret', () => {
    assert.equal(verifySessionToken(createSessionToken(SECRET, NOW), SECRET, NOW), true)
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

describe('personal account sessions', () => {
  const key = userSessionKey(SECRET, 3, 0)
  const keyOf = (id: number) => (id === 3 ? key : null)

  it('names its account and holds only with that account’s key', () => {
    const token = createUserSessionToken(3, key, NOW)
    assert.equal(userIdOfToken(token), 3)
    assert.equal(verifyUserSessionToken(token, keyOf, NOW), 3)
    // Another account's number on the same signature, or an unknown account, signs in no one.
    assert.equal(
      verifyUserSessionToken(token.replace('v2.3.', 'v2.4.'), () => key, NOW),
      null
    )
    assert.equal(verifyUserSessionToken(createUserSessionToken(5, key, NOW), keyOf, NOW), null)
  })

  // A new password raises the generation (see user-accounts.test.ts).
  it('stops with a new generation, another server secret or its expiry', () => {
    const token = createUserSessionToken(3, key, NOW, 60)
    assert.equal(
      verifyUserSessionToken(token, () => userSessionKey(Buffer.alloc(32, 9), 3, 0), NOW),
      null
    )
    assert.equal(
      verifyUserSessionToken(token, () => userSessionKey(SECRET, 3, 1), NOW),
      null
    )
    // A session signed when the key held the password hash no longer holds.
    const before = createUserSessionToken(3, createHmac('sha256', SECRET).update('user.3.hash.0').digest(), NOW, 60)
    assert.equal(verifyUserSessionToken(before, keyOf, NOW), null)
    assert.equal(verifyUserSessionToken(token, keyOf, NOW + 61_000), null)
  })

  it('is never taken for the household’s shared session, nor the other way round', () => {
    assert.equal(verifySessionToken(createUserSessionToken(3, key, NOW), key, NOW), false)
    assert.equal(userIdOfToken(createSessionToken(key, NOW)), null)
    assert.equal(verifyUserSessionToken(createSessionToken(key, NOW), keyOf, NOW), null)
  })
})
