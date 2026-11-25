import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ACCENT_KEY, applyLook, keepAccent } from '../src/lib/theme.ts'

// public/theme.js puts the kept colour back before the first paint.
const THEME_SCRIPT = readFileSync(path.join(import.meta.dirname, '../public/theme.js'), 'utf8')

describe('the profile’s colour as the accent', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    delete document.documentElement.dataset.accent
    delete document.documentElement.dataset.theme
  })

  it('keeps a copy for the next start, and forgets it when no profile is open', () => {
    keepAccent('world')
    expect(localStorage.getItem(ACCENT_KEY)).toBe('world')
    keepAccent(null)
    expect(localStorage.getItem(ACCENT_KEY)).toBeNull()
  })

  it('sets the colour and the theme on the page, and takes them off', () => {
    applyLook('light', 'tech')
    expect(document.documentElement.dataset).toMatchObject({ theme: 'light', accent: 'tech' })
    applyLook('system', null)
    expect(document.documentElement.dataset.theme).toBeUndefined()
    expect(document.documentElement.dataset.accent).toBeUndefined()
    expect(localStorage.getItem(ACCENT_KEY)).toBeNull()
  })

  it('still colours the page when the device refuses storage', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('refused')
    })
    expect(() => applyLook('dark', 'sport')).not.toThrow()
    expect(document.documentElement.dataset.accent).toBe('sport')
  })

  it('puts the kept colour back before the first paint, and none once forgotten', () => {
    keepAccent('music')
    new Function(THEME_SCRIPT)()
    expect(document.documentElement.dataset.accent).toBe('music')
    delete document.documentElement.dataset.accent
    keepAccent(null)
    new Function(THEME_SCRIPT)()
    expect(document.documentElement.dataset.accent).toBeUndefined()
  })
})
