import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { dayOf, dayRange, isTimeZone } from '../news/days.ts'

describe('days', () => {
  it('names the day in the reader time zone', () => {
    // 23:30 UTC is already the next day in Brussels.
    assert.equal(dayOf(Date.UTC(2026, 9, 24, 23, 30), 'Europe/Brussels'), '2026-10-25')
    assert.equal(dayOf(Date.UTC(2026, 9, 24, 23, 30), 'UTC'), '2026-10-24')
  })

  it('spans the day from local midnight, 25 hours long when the clocks go back', () => {
    assert.deepEqual(dayRange('2026-10-24', 'Europe/Brussels'), {
      day: '2026-10-24',
      start: '2026-10-23T22:00:00.000Z',
      end: '2026-10-24T22:00:00.000Z'
    })
    assert.deepEqual(dayRange('2026-10-25', 'Europe/Brussels'), {
      day: '2026-10-25',
      start: '2026-10-24T22:00:00.000Z',
      end: '2026-10-25T23:00:00.000Z'
    })
    assert.deepEqual(dayRange('2026-03-29', 'Europe/Brussels'), {
      day: '2026-03-29',
      start: '2026-03-28T23:00:00.000Z',
      end: '2026-03-29T22:00:00.000Z'
    })
  })

  it('refuses dates that do not exist and unknown time zones', () => {
    assert.equal(dayRange('2026-02-30', 'UTC'), null)
    assert.equal(dayRange('24/10/2026', 'UTC'), null)
    assert.equal(isTimeZone('Mars/Olympus'), false)
    assert.equal(isTimeZone('Europe/Brussels'), true)
  })
})
