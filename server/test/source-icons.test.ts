import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { openDatabase } from '../db/database.ts'
import { NewsStore } from '../db/news-store.ts'
import { parseCatalog } from '../news/catalog.ts'
import { SourceIcons, declaredIcons, imageType } from '../news/source-icons.ts'
import { type FakeResponse, PNG, fakeFetch } from './helpers/news.ts'

const NOW = Date.UTC(2026, 9, 24, 12)
const DAY = 24 * 60 * 60 * 1000

const catalog = parseCatalog(`
topics:
  - id: monde
    label: Monde
    sources:
      - id: alpha
        name: Alpha
        url: https://alpha.example/feed
        domains: [alpha.example]
`)

const home = `<html><head>
<link rel="icon" href="/favicon-16.png" sizes="16x16">
<link rel="mask-icon" href="/mask.svg">
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<link rel="apple-touch-icon" href="https://cdn.alpha.example/touch.png">
</head></html>`

const icons = (responses: Record<string, FakeResponse>, store?: NewsStore, now = NOW) => {
  const fake = fakeFetch(responses)
  return {
    icons: new SourceIcons(catalog, { ...fake, store, now: () => now, log: () => {} }),
    calls: fake.calls
  }
}

describe('SourceIcons', () => {
  it('reads the icons a home page declares, the largest first, without SVG', () => {
    assert.deepEqual(declaredIcons(home, 'https://alpha.example/'), [
      'https://cdn.alpha.example/touch.png',
      'https://alpha.example/favicon-16.png'
    ])
  })

  it('takes the type from the bytes, never from the site', () => {
    assert.equal(imageType(PNG), 'image/png')
    assert.equal(imageType(new TextEncoder().encode('<svg onload="alert(1)">')), null)
  })

  it('fetches a source icon once and keeps it across a restart', async () => {
    const store = new NewsStore(openDatabase(':memory:'))
    const first = icons({ 'https://alpha.example/': home, 'https://cdn.alpha.example/touch.png': PNG }, store)

    const icon = await first.icons.get('alpha')
    assert.equal(icon?.contentType, 'image/png')
    assert.deepEqual([...(icon?.data ?? [])], [...PNG])
    await first.icons.get('alpha')
    assert.equal(first.calls.length, 2)

    const second = icons({}, store)
    assert.equal((await second.icons.get('alpha'))?.contentType, 'image/png')
    assert.equal(second.calls.length, 0)
  })

  it('falls back to the usual places, then to nothing', async () => {
    const found = icons({ 'https://alpha.example/': '<html></html>', 'https://alpha.example/favicon.ico': PNG })
    assert.equal((await found.icons.get('alpha'))?.contentType, 'image/png')

    // A page served instead of an image is not an icon.
    const none = icons({ 'https://alpha.example/': '<html></html>', 'https://alpha.example/favicon.ico': '<html>' })
    assert.equal(await none.icons.get('alpha'), null)
    assert.equal(await none.icons.get('nope'), undefined)
  })

  it('keeps the icon it has when the site is down', async () => {
    const store = new NewsStore(openDatabase(':memory:'))
    await icons({ 'https://alpha.example/': home, 'https://cdn.alpha.example/touch.png': PNG }, store).icons.get(
      'alpha'
    )

    const down = icons({ 'https://alpha.example/': new Error('ECONNRESET') }, store, NOW + 31 * DAY)
    assert.equal((await down.icons.get('alpha'))?.contentType, 'image/png')
  })
})
