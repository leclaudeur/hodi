import { describe, expect, it } from 'vitest'
import { publicHomeFor } from '../src/lib/public-home.ts'

describe('publicHomeFor', () => {
  it('sends a browser that never signed in, at the bare address, to the public site', () => {
    expect(publicHomeFor('https://get-hodi.com', '', false)).toBe('https://get-hodi.com')
    expect(publicHomeFor('https://get-hodi.com', '#/', false)).toBe('https://get-hodi.com')
  })

  it('keeps Connexion for a browser that signed in before, an address of its own, or no site', () => {
    expect(publicHomeFor('https://get-hodi.com', '', true)).toBeNull()
    expect(publicHomeFor('https://get-hodi.com', '#/sign-in', false)).toBeNull()
    expect(publicHomeFor('https://get-hodi.com', '#/code/ABCD', false)).toBeNull()
    expect(publicHomeFor(null, '', false)).toBeNull()
  })
})
