import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Source } from '../news/catalog.ts'
import { FeedCache, MAX_PARALLEL_FEEDS } from '../news/feed-cache.ts'

const rss = '<?xml version="1.0"?><rss version="2.0"><channel><title>Site</title></channel></rss>'
const source = (index: number): Source => ({
  id: `site-${index}`,
  name: `Site ${index}`,
  url: `https://site-${index}.example/feed`,
  kind: 'article',
  lang: 'fr',
  domains: [`site-${index}.example`],
  reader: true,
  skip: []
})

describe('FeedCache', () => {
  it('fetches a few feeds at a time, so that none waits out its timeout behind the others', async () => {
    let running = 0
    let most = 0
    const fetched: string[] = []
    const cache = new FeedCache({
      fetchText: async url => {
        running += 1
        most = Math.max(most, running)
        await new Promise(resolve => setTimeout(resolve, 5))
        running -= 1
        fetched.push(url)
        return { url, text: rss }
      },
      readPluginFeed: undefined,
      store: undefined,
      isPaused: () => false,
      now: () => Date.now(),
      log: () => {}
    })

    await cache.refreshAll(Array.from({ length: 30 }, (_, index) => source(index)))

    assert.equal(fetched.length, 30)
    assert.equal(most, MAX_PARALLEL_FEEDS)
  })
})
