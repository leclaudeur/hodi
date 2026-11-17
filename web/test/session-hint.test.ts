import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { rememberProfileOpen, rememberSession } from '../src/lib/session-hint.ts'

// public/preload.js reads these keys: the signed-in app's first requests only after a session, and the profile's own
// data only in a tab that had a profile open.
const read = () => localStorage.getItem('hodi:had-session')
const PRELOAD = readFileSync(path.join(import.meta.dirname, '../public/preload.js'), 'utf8')

// The addresses preload.js asks for, as it runs in the page.
const preloaded = () => {
  document.head.querySelectorAll('link[rel="preload"]').forEach(link => link.remove())
  new Function(PRELOAD)()
  return [...document.head.querySelectorAll<HTMLLinkElement>('link[rel="preload"]')].map(link =>
    link.getAttribute('href')
  )
}

describe('session hint', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('says nothing in a browser that never had a session', () => {
    expect(read()).toBeNull()
  })

  it('remembers a session, then forgets it once signed out', () => {
    rememberSession(true)
    expect(read()).toBe('1')
    rememberSession(false)
    expect(read()).toBeNull()
  })

  it('preloads only the session for a visitor', () => {
    expect(preloaded()).toEqual(['/api/session'])
  })

  // Each would be refused for a profile that asks for its password: a burst a proxy like CrowdSec bans as probing.
  it('preloads only « Qui lit ? » in a tab with no profile open', () => {
    rememberSession(true)
    expect(preloaded()).toEqual(['/api/session', '/api/profiles'])
    rememberProfileOpen(true)
    rememberProfileOpen(false)
    expect(preloaded()).toEqual(['/api/session', '/api/profiles'])
  })

  it("preloads the profile's data in a tab that had it open", () => {
    rememberSession(true)
    rememberProfileOpen(true)
    expect(preloaded()).toContain('/api/me/limits')
    expect(preloaded()).toContain(
      '/api/feed?tz=' + encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)
    )
  })
})
