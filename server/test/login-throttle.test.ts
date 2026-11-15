import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { LoginThrottle, clientKey } from '../auth/login-throttle.ts'

describe('login throttle', () => {
  it('blocks after the maximum number of failures', () => {
    const throttle = new LoginThrottle(3, 60_000)

    for (const time of [0, 1_000, 2_000]) {
      assert.deepEqual(throttle.check(time), { allowed: true })
      throttle.recordFailure(time)
    }

    assert.deepEqual(throttle.check(3_000), { allowed: false, retryAfterSeconds: 57 })
  })

  it('allows attempts again once old failures leave the window', () => {
    const throttle = new LoginThrottle(2, 60_000)

    throttle.recordFailure(0)
    throttle.recordFailure(10_000)

    assert.equal(throttle.check(59_999).allowed, false)
    assert.equal(throttle.check(60_000).allowed, true)
  })

  it('counts each client apart', () => {
    const throttle = new LoginThrottle(2, 60_000)

    throttle.recordFailure(0, '203.0.113.1')
    throttle.recordFailure(1_000, '203.0.113.1')

    assert.equal(throttle.check(2_000, '203.0.113.1').allowed, false)
    assert.deepEqual(throttle.check(2_000, '198.51.100.7'), { allowed: true })
  })

  it('still caps failures spread over many clients', () => {
    const throttle = new LoginThrottle(2, 60_000, 4)

    for (const [index, client] of ['a', 'b', 'c', 'd'].entries()) throttle.recordFailure(index * 1_000, client)

    assert.deepEqual(throttle.check(5_000, 'e'), { allowed: false, retryAfterSeconds: 55 })
    assert.equal(throttle.check(60_000, 'e').allowed, true)
  })

  // One IPv6 connection holds a whole /64: each of its addresses getting ten tries would be no limit at all.
  it('counts an IPv6 client by its /64', () => {
    const throttle = new LoginThrottle(2, 60_000)

    throttle.recordFailure(0, '2001:db8:1:2::1')
    throttle.recordFailure(1_000, '2001:db8:1:2:ffff:ffff:ffff:ffff')

    assert.equal(throttle.check(2_000, '2001:db8:1:2:abcd::9').allowed, false)
    assert.deepEqual(throttle.check(2_000, '2001:db8:1:3::1'), { allowed: true })
  })

  it('names a client by its /64, an IPv4 address mapped in IPv6 by itself', () => {
    assert.equal(clientKey('2001:db8:1:2::1'), clientKey('2001:0db8:0001:0002:0000:0000:0000:0042'))
    assert.notEqual(clientKey('2001:db8:1:2::1'), clientKey('2001:db8:1:3::1'))
    assert.equal(clientKey('::ffff:203.0.113.7'), '203.0.113.7')
    assert.equal(clientKey('203.0.113.7'), '203.0.113.7')
    assert.equal(clientKey(''), '')
  })
})
