import { describe, expect, it } from 'vitest'
import { readForGood } from '../src/views/reader/reading-progress.ts'

// A 5-minute article: read once 80% of it scrolled by and the time needed (here 1.75 min) spent.
const article = { needed: 1.75, estimate: 5, fits: false }

describe('read for good', () => {
  it('needs both the scrolling and the time', () => {
    expect(readForGood({ ...article, minutes: 2, furthest: 0.8 })).toBe(true)
    // Scrolled to the end at once: only skimmed.
    expect(readForGood({ ...article, minutes: 0.5, furthest: 1 })).toBe(false)
    // Left open without scrolling.
    expect(readForGood({ ...article, minutes: 10, furthest: 0.3 })).toBe(false)
  })

  it('takes only the time for a text that shows whole at once', () => {
    expect(readForGood({ ...article, fits: true, minutes: 2, furthest: 0 })).toBe(true)
    expect(readForGood({ ...article, fits: true, minutes: 1, furthest: 0 })).toBe(false)
  })

  it('never reads a text without an estimate', () => {
    expect(readForGood({ needed: 0, estimate: 0, fits: true, minutes: 5, furthest: 1 })).toBe(false)
  })
})
