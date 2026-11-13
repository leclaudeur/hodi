import { describe, expect, it } from 'vitest'
import { changeOf, shortFigure } from '../src/lib/overview-figures.ts'

describe('overview figures', () => {
  it('writes up to 999 in full, then in thousands', () => {
    expect(shortFigure(999, 'fr')).toEqual({ text: '999', thousands: false })
    expect(shortFigure(1700, 'fr')).toEqual({ text: '1,7', thousands: true })
    expect(shortFigure(2250, 'en')).toEqual({ text: '2.3', thousands: true })
    expect(shortFigure(4.25, 'en', 1)).toEqual({ text: '4.3', thousands: false })
  })

  it('compares with the period before, when there was one', () => {
    expect(changeOf(112, 100)).toBe(12)
    expect(changeOf(50, 100)).toBe(-50)
    expect(changeOf(5, 0)).toBeNull()
    expect(changeOf(5, null)).toBeNull()
  })
})
