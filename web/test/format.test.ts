import { describe, expect, it } from 'vitest'
import { dayLabel, hostOf, localDay, shortAgo, timeAgo } from '../src/lib/format.ts'

// Saturday 24 October 2026, 10:00 in Brussels (the tests run in that time zone).
const NOW = new Date('2026-10-24T10:00:00+02:00').getTime()
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()
// Intl puts non-breaking spaces in "il y a 25 min".
const plain = (text: string | null) => text?.replace(/\s/g, ' ') ?? null

describe('dates', () => {
  it('says how long ago, in minutes, hours, then days', () => {
    expect(plain(timeAgo(ago(25), NOW))).toBe('il y a 25 min')
    expect(plain(timeAgo(ago(0), NOW))).toBe('il y a 1 min')
    expect(plain(timeAgo(ago(180), NOW))).toBe('il y a 3 h')
    expect(plain(timeAgo(ago(24 * 60), NOW))).toBe('hier')
    expect(timeAgo(null, NOW)).toBeNull()
  })

  it('writes the short form of the mobile cards', () => {
    expect(shortAgo(ago(40), NOW)).toBe('40 MIN')
    expect(shortAgo(ago(0), NOW)).toBe('1 MIN')
    expect(shortAgo(ago(3 * 60), NOW)).toBe('3 H')
    expect(shortAgo(ago(2 * 24 * 60), NOW)).toBe('2 J')
  })

  it('names the days of Le fil', () => {
    expect(localDay(NOW)).toBe('2026-10-24')
    expect(dayLabel('2026-10-24', NOW)).toBe('Aujourd’hui')
    expect(dayLabel('2026-10-23', NOW)).toBe('Hier · ven. 23.10')
    expect(dayLabel('2026-10-22', NOW)).toBe('jeu. 22.10')
  })

  it('counts the day in local time, not in UTC', () => {
    // 00:30 in Brussels is still the day before in UTC.
    expect(localDay(new Date('2026-10-25T00:30:00+02:00').getTime())).toBe('2026-10-25')
  })

  it('shows a link’s site without www', () => {
    expect(hostOf('https://www.rtbf.be/article/x')).toBe('rtbf.be')
  })
})
