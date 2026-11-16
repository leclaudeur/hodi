import { describe, expect, it } from 'vitest'
import { articleDepthOf } from '../src/pages/home-routes.ts'

describe('articleDepthOf', () => {
  it('counts the articles opened one after the other since the list', () => {
    expect(articleDepthOf(false, undefined, 3)).toBe(0)
    expect(articleDepthOf(true, undefined, 0)).toBe(1)
    expect(articleDepthOf(true, undefined, 2)).toBe(3)
  })

  it('keeps the count of an entry come back to', () => {
    expect(articleDepthOf(true, 1, 4)).toBe(1)
    expect(articleDepthOf(false, 2, 2)).toBe(0)
  })
})
