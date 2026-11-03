import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { channelIdOf, createSourceFinder, feedLinks, isPublicUrl } from '../news/source-finder.ts'
import { type FakeResponse, articlePage, fakeFetch, rssFeed } from './helpers/news.ts'

const DATE = 'Fri, 23 Oct 2026 10:00:00 +0000'
const blogFeed = rssFeed([
  { title: 'Premier', link: 'https://blog.example/premier', date: DATE },
  { title: 'Deuxième', link: 'https://blog.example/deuxieme', date: DATE },
  { title: 'Troisième', link: 'https://blog.example/troisieme', date: DATE }
])
const articles = {
  'https://blog.example/premier': articlePage('Premier'),
  'https://blog.example/deuxieme': articlePage('Deuxième'),
  'https://blog.example/troisieme': articlePage('Troisième')
}

const finder = (responses: Record<string, FakeResponse>, youtube: Record<string, string> = {}) => {
  const fake = fakeFetch(responses)
  const find = createSourceFinder({
    fetchText: fake.fetchText,
    fetchYouTube: async url => youtube[url] ?? '',
    isPublic: async url => url.protocol === 'https:' && !url.hostname.endsWith('.lan')
  })
  return { find, calls: fake.calls }
}

describe('source finder', () => {
  it('finds the feed a site names, and tries three articles in the reader', async () => {
    const { find } = finder({
      'https://blog.example/': `<html><head><link rel="alternate" type="application/rss+xml" href="/flux.xml"></head></html>`,
      'https://blog.example/flux.xml': blogFeed,
      ...articles
    })

    const result = await find('blog.example')

    assert.equal(result.status, 'ok')
    assert.deepEqual(result.status === 'ok' && result.source, {
      name: 'Feed',
      url: 'https://blog.example/flux.xml',
      kind: 'article',
      lang: 'fr',
      domains: ['blog.example'],
      reader: true,
      origin: 'feed',
      readable: { tried: 3, ok: 3 },
      samples: ['Premier', 'Deuxième', 'Troisième']
    })
  })

  it('keeps a source whose articles do not open as summaries with a link', async () => {
    const { find } = finder({ 'https://blog.example/feed': blogFeed })

    const result = await find('https://blog.example/feed')

    assert.equal(result.status === 'ok' && result.source.reader, false)
    assert.deepEqual(result.status === 'ok' && result.source.domains, [])
  })

  it('guesses the usual feed address when the page names none', async () => {
    const { find } = finder({ 'https://blog.example/': '<html></html>', 'https://blog.example/rss.xml': blogFeed })

    const result = await find('https://blog.example/')

    assert.equal(result.status === 'ok' && result.source.url, 'https://blog.example/rss.xml')
  })

  it('still guesses the usual feed address when the page itself turns Hodi away', async () => {
    const { find } = finder({ 'https://blog.example/rss.xml': blogFeed })

    const result = await find('https://blog.example/')

    assert.equal(result.status === 'ok' && result.source.url, 'https://blog.example/rss.xml')
    assert.equal((await find('https://other.example/')).status, 'failed')
  })

  it('follows a YouTube channel from its page, and turns a Reddit link down', async () => {
    const channel = 'UC2KS7d-AX_qTnazWE1Ey9tA'
    const videos = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015"><title>Ma chaîne</title>
<entry><yt:videoId>aqz-KE-bpKQ</yt:videoId><title>Vidéo</title><link rel="alternate" href="https://www.youtube.com/watch?v=aqz-KE-bpKQ"/><published>2026-10-23T10:00:00+00:00</published></entry></feed>`
    const { find } = finder(
      {
        [`https://www.youtube.com/feeds/videos.xml?channel_id=${channel}`]: videos
      },
      {
        'https://www.youtube.com/@machaine': `<link rel="canonical" href="https://www.youtube.com/channel/${channel}">`
      }
    )

    const video = await find('https://www.youtube.com/@machaine/videos')
    const reddit = await find('https://www.reddit.com/r/belgique/')

    assert.equal(video.status === 'ok' && video.source.kind, 'video')
    assert.equal(video.status === 'ok' && video.source.name, 'Ma chaîne')
    // Reddit closed its feeds: nothing is fetched.
    assert.equal(reddit.status, 'reddit')
  })

  it('never fetches a private address', async () => {
    const { find, calls } = finder({ 'https://nas.lan/feed': blogFeed })

    assert.deepEqual(await find('https://nas.lan/feed'), { status: 'blocked' })
    assert.deepEqual(calls, [])
    assert.deepEqual(await find('pas un lien ::'), { status: 'invalid' })
  })

  it('reads feed links and channel ids from pages', () => {
    assert.deepEqual(
      feedLinks(
        `<link href='atom' type='application/atom+xml' rel='alternate'><link rel="stylesheet" href="x.css">`,
        'https://a.example/b/'
      ),
      ['https://a.example/b/atom']
    )
    assert.equal(channelIdOf('"externalId":"UCnUiNjxobt87xkhf9Fo7_Dw"'), 'UCnUiNjxobt87xkhf9Fo7_Dw')
  })

  it('refuses local and private addresses', async () => {
    assert.equal(await isPublicUrl(new URL('https://127.0.0.1/feed')), false)
    assert.equal(await isPublicUrl(new URL('https://192.168.1.10/feed')), false)
    assert.equal(await isPublicUrl(new URL('https://[::1]/feed')), false)
    assert.equal(await isPublicUrl(new URL('http://93.184.216.34/feed')), false)
    assert.equal(await isPublicUrl(new URL('https://localhost/feed')), false)
    assert.equal(await isPublicUrl(new URL('https://93.184.216.34/feed')), true)
  })
})
