import { afterEach, describe, expect, it, vi } from 'vitest'
import { timeZoneCountry } from '../src/lib/regions.ts'

const speaks = (...languages: string[]) => vi.spyOn(navigator, 'languages', 'get').mockReturnValue(languages)

describe('the country a first install guesses', () => {
  afterEach(() => vi.restoreAllMocks())

  it('follows the device’s time zone rather than its language', async () => {
    speaks('fr-BE', 'fr')
    expect(await timeZoneCountry('America/New_York')).toBe('US')
  })

  it('lets the language choose among the countries of one zone', async () => {
    speaks('nl-NL')
    expect(await timeZoneCountry('Europe/Brussels')).toBe('NL')
    speaks('fr-BE')
    expect(await timeZoneCountry('Europe/Brussels')).toBe('BE')
    speaks('en')
    expect(await timeZoneCountry('Europe/Brussels')).toBe('BE')
  })

  it('falls back on the language when the zone names no country', async () => {
    speaks('fr-BE')
    expect(await timeZoneCountry('Etc/UTC')).toBe('BE')
    speaks('en')
    expect(await timeZoneCountry('Etc/UTC')).toBeNull()
  })
})
