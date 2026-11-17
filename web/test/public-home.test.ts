import { describe, expect, it } from 'vitest'
import { publicHomeFor } from '../src/lib/public-home.ts'

const at = (hash: string, search = '') => ({ hash, search })

describe('publicHomeFor', () => {
  it('sends a browser that never signed in, at the bare address, to the public site', () => {
    expect(publicHomeFor('https://get-hodi.com', at(''), false, false)).toBe('https://get-hodi.com')
    expect(publicHomeFor('https://get-hodi.com', at('#/'), false, false)).toBe('https://get-hodi.com')
  })

  it('keeps Connexion for a browser that signed in before, an address of its own, or no site', () => {
    expect(publicHomeFor('https://get-hodi.com', at(''), true, false)).toBeNull()
    expect(publicHomeFor('https://get-hodi.com', at('#/sign-in'), false, false)).toBeNull()
    expect(publicHomeFor('https://get-hodi.com', at('#/code/ABCD'), false, false)).toBeNull()
    expect(publicHomeFor(null, at(''), false, false)).toBeNull()
  })

  it('keeps Connexion for a sign-in service coming back to the bare address with its code', () => {
    expect(publicHomeFor('https://get-hodi.com', at('', '?state=abc&code=xyz'), false, false)).toBeNull()
  })

  it('keeps Connexion for the app opened from a home screen, even never signed in there', () => {
    expect(publicHomeFor('https://get-hodi.com', at(''), false, true)).toBeNull()
  })
})
