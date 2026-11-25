import { describe, expect, it } from 'vitest'
import { backTo, recordMove } from '../src/lib/came-from.ts'

describe('came from', () => {
  it('falls back when the page was opened from its own address', () => {
    expect(backTo('#/account', '#/settings')).toBe('#/settings')
  })

  it('returns to the address Mon compte was opened from, through its sections', () => {
    recordMove('#/followed', '#/account/display')
    recordMove('#/account/display', '#/account/ai')
    expect(backTo('#/account', '#/settings')).toBe('#/followed')
  })

  it('takes the latest opening, the front page for an empty hash', () => {
    recordMove('', '#/catalogue')
    expect(backTo('#/catalogue', '#/settings/sources')).toBe('#/')
    recordMove('#/settings/sources', '#/catalogue/tech')
    expect(backTo('#/catalogue', '#/settings/sources')).toBe('#/settings/sources')
  })

  it('never takes an address that only starts like a page', () => {
    recordMove('#/saved', '#/accounting')
    expect(backTo('#/account', '#/settings')).toBe('#/followed')
  })

  it('keeps a page’s origin when another page opened from it goes back to it', () => {
    recordMove('#/settings/sources', '#/catalogue/world')
    recordMove('#/catalogue/world', '#/account/profile')
    recordMove('#/account/profile', '#/catalogue/world')
    expect(backTo('#/catalogue', '#/settings/sources')).toBe('#/settings/sources')
    expect(backTo('#/account', '#/settings')).toBe('#/catalogue/world')
  })
})
