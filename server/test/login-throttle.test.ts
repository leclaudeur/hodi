import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { LoginThrottle } from '../auth/login-throttle.ts'

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
})
