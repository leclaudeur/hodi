import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Secret, TOTP } from 'otpauth'
import { openDatabase } from '../db/database.ts'
import { PENDING_LIFETIME, TwoFactorStore, recoveryCodeOf } from '../db/two-factor-store.ts'
import { UserAccountStore } from '../db/user-account-store.ts'

const appCode = (secret: string, at: number) =>
  new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 }).generate({ timestamp: at })

const setUp = () => {
  const db = openDatabase(':memory:')
  const account = new UserAccountStore(db).create('antho@example.com', 'hash', 0)!
  return { store: new TwoFactorStore(db, Buffer.alloc(32, 7)), id: account.id }
}

describe('two-factor store', () => {
  const now = Date.UTC(2026, 10, 9, 10, 0, 0)

  it('forgets a secret not confirmed within 15 minutes', () => {
    const { store, id } = setUp()
    const { secret } = store.start(id, 'antho@example.com', now)
    const late = now + PENDING_LIFETIME + 1
    assert.equal(store.confirm(id, appCode(secret, late), late), null)
    assert.equal(store.isOn(id), false)
  })

  it('takes the code of the step before or after, not older ones', () => {
    const { store, id } = setUp()
    const { secret } = store.start(id, 'antho@example.com', now)
    assert.ok(store.confirm(id, appCode(secret, now), now))
    const later = now + 5 * 60_000
    assert.equal(store.verify(id, appCode(secret, later - 60_000), later), false)
    assert.equal(store.verify(id, appCode(secret, later - 30_000), later), true)
    assert.equal(store.verify(id, appCode(secret, later + 30_000), later), true)
    // A step before one already used: never again.
    assert.equal(store.verify(id, appCode(secret, later), later), false)
  })

  it('makes new recovery codes that replace the old ones, each used once', () => {
    const { store, id } = setUp()
    const { secret } = store.start(id, 'antho@example.com', now)
    const first = store.confirm(id, appCode(secret, now), now)!
    const second = store.newRecoveryCodes(id)
    assert.equal(store.verify(id, first[0], now), false)
    assert.equal(store.verify(id, `  ${second[1]!.toLowerCase()} `.trim(), now), true)
    assert.equal(store.verify(id, second[1], now), false)
    assert.deepEqual(store.status(id), { since: now, recoveryLeft: 9 })
    // Not for a moment that only takes the app's code.
    assert.equal(store.verify(id, second[2], now, { recovery: false }), false)
  })

  it('reads recovery codes typed with spaces, dashes or small letters, and nothing else', () => {
    assert.equal(recoveryCodeOf('abcd-ef23'), 'ABCDEF23')
    assert.equal(recoveryCodeOf('ABCD EF23'), 'ABCDEF23')
    assert.equal(recoveryCodeOf('ABCD-EF2O'), null)
    assert.equal(recoveryCodeOf(12345678), null)
  })
})
