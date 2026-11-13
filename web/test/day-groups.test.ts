import { describe, expect, it } from 'vitest'
import { groupByDay } from '../src/lib/day-groups.ts'

describe('groupByDay', () => {
  it('keeps the order and starts a group at each new day', () => {
    const entries = [
      { id: 'a', day: '2026-11-10' },
      { id: 'b', day: '2026-11-10' },
      { id: 'c', day: '2026-11-09' }
    ]
    expect(
      groupByDay(
        entries,
        entry => entry.day,
        entry => entry.id
      )
    ).toEqual([
      { day: '2026-11-10', items: ['a', 'b'] },
      { day: '2026-11-09', items: ['c'] }
    ])
  })

  it('starts a new group when a day comes back after another one', () => {
    const days = ['2026-11-10', '2026-11-09', '2026-11-10']
    expect(
      groupByDay(
        days,
        day => day,
        day => day
      ).map(group => group.day)
    ).toEqual(days)
  })

  it('gives no group for no entry', () => {
    expect(
      groupByDay(
        [],
        () => '',
        () => ''
      )
    ).toEqual([])
  })
})
