import { describe, expect, it } from 'vitest'
import { deviceLabel } from '../src/lib/device-label.ts'

describe('deviceLabel', () => {
  it('names the system and the browser', () => {
    expect(
      deviceLabel(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
      )
    ).toBe('iPhone · Safari')
    expect(
      deviceLabel('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36')
    ).toBe('Linux · Chrome')
    expect(
      deviceLabel(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0'
      )
    ).toBe('PC Windows · Edge')
    expect(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:131.0) Gecko/20100101 Firefox/131.0')).toBe(
      'Mac · Firefox'
    )
  })

  it('says the installed app, or the word given for an unknown browser', () => {
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 15) Chrome/140.0', { standalone: true })).toBe(
      'Android · Hodi (PWA)'
    )
    expect(deviceLabel('curl/8.0', { browser: 'Browser' })).toBe('Linux · Browser')
  })
})
