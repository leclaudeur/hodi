import { beforeEach, describe, expect, it } from 'vitest'
import { rememberSession } from '../src/lib/session-hint.ts'

// public/preload.js reads this key: it asks for the signed-in app's first requests only when it says '1'.
const read = () => localStorage.getItem('hodi:had-session')

describe('session hint', () => {
  beforeEach(() => localStorage.clear())

  it('says nothing in a browser that never had a session', () => {
    expect(read()).toBeNull()
  })

  it('remembers a session, then forgets it once signed out', () => {
    rememberSession(true)
    expect(read()).toBe('1')
    rememberSession(false)
    expect(read()).toBeNull()
  })
})
