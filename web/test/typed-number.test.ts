import { describe, expect, it } from 'vitest'
import { typedDigits, typedNumber } from '../src/lib/typed-number.ts'

describe('typedNumber', () => {
  it('reads the digits, kept between the bounds', () => {
    expect(typedNumber('250', 1, 10_000)).toBe(250)
    expect(typedNumber(' 1 000 ', 1, 10_000)).toBe(1000)
    expect(typedNumber('0', 1, 10_000)).toBe(1)
    expect(typedNumber('99999', 1, 10_000)).toBe(10_000)
  })

  it('is null while nothing is typed', () => {
    expect(typedNumber('', 1, 10)).toBeNull()
    expect(typedNumber('abc', 1, 10)).toBeNull()
  })
})

describe('typedDigits', () => {
  it('keeps no more digits than the largest value has', () => {
    expect(typedDigits('12a345', 10_000)).toBe('12345')
    expect(typedDigits('123456', 10_000)).toBe('12345')
    expect(typedDigits('42', 30)).toBe('42')
  })
})
