import { describe, expect, it } from 'vitest'
import { evenTicks } from '../src/lib/even-ticks.ts'

describe('evenTicks', () => {
  it('writes every day when they all fit', () => {
    expect(evenTicks(7, 700, 60)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('spreads the days evenly, first and last included, when they do not', () => {
    expect(evenTicks(7, 260, 60)).toEqual([0, 2, 4, 6])
    expect(evenTicks(30, 300, 60)).toEqual([0, 7, 15, 22, 29])
  })

  it('keeps at least the first and the last day', () => {
    expect(evenTicks(7, 50, 60)).toEqual([0, 6])
    expect(evenTicks(1, 50, 60)).toEqual([0])
    expect(evenTicks(0, 500, 60)).toEqual([])
  })
})
