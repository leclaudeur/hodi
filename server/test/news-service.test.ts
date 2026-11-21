import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseCatalog } from '../news/catalog.ts'
import { NewsService, TOPIC_PAGE_SIZE } from '../news/news-service.ts'
import { type AiTools } from '../news/news-types.ts'
import { AI_CALLS_PER_MINUTE } from '../news/ai-ledger.ts'
import type { DailySummaryStory } from '../news/daily-summary.ts'
import { type SummaryInput, SummaryRefusedError, articleText } from '../news/summarizer.ts'
import { itemId } from '../news/text.ts'
import { parseVideoDuration } from '../news/video-durations.ts'
import { openDatabase } from '../db/database.ts'
import { NewsStore } from '../db/news-store.ts'
import { type FakeResponse, articleBody, articlePage, fakeFetch, rssFeed } from './helpers/news.ts'

const NOW = Date.UTC(2026, 9, 23, 12)

const catalog = parseCatalog(`
topics:
  - id: world
    label: Monde
    sources:
      - id: alpha
        name: Alpha
        url: https://alpha.example/feed
        domains: [alpha.example]
      - id: beta
        name: Beta
        url: https://beta.example/feed
        domains: [beta.example]
`)

const alphaFeed = rssFeed([
  { title: 'Sommet européen', link: 'https://alpha.example/sommet', date: 'Fri, 23 Oct 2026 10:00:00 +0000' },
  { title: 'Vieille nouvelle', link: 'https://alpha.example/vieux', date: 'Mon, 12 Oct 2026 10:00:00 +0000' },
  { title: 'Lien externe', link: 'https://other.example/x', date: 'Fri, 23 Oct 2026 09:00:00 +0000' }
])

const betaFeed = rssFeed([
  { title: 'Sommet  Européen !', link: 'https://beta.example/sommet', date: 'Fri, 23 Oct 2026 11:00:00 +0000' },
  { title: 'Élections', link: 'https://beta.example/elections', date: 'Fri, 23 Oct 2026 08:00:00 +0000' }
])

const setup = (responses: Record<string, FakeResponse>) => {
  let clock = NOW
  const fake = fakeFetch(responses)
  const news = new NewsService(catalog, { fetchText: fake.fetchText, now: () => clock, log: () => {} })

  return { news, calls: fake.calls, advance: (ms: number) => (clock += ms) }
}

const idOf = (link: string) => itemId(link)
const isFeed = (url: string) => url.endsWith('/feed')

const feeds = { 'https://alpha.example/feed': alphaFeed, 'https://beta.example/feed': betaFeed }

// More calls than any daily cap ever allowed: each reader pays with its own key, and nothing stops it.
const MANY = 120
// Calls a person may click through in a day: a few seconds apart, under the per-minute runaway guard.
const spacedClock = () => {
  let at = NOW
  return { now: () => at, next: () => (at += 3_000) }
}

describe('NewsService', () => {
  it('does not fetch a source every profile turned off', async () => {
    const fake = fakeFetch(feeds)
    const news = new NewsService(catalog, {
      fetchText: fake.fetchText,
      isPaused: id => id === 'beta',
      now: () => NOW,
      log: () => {}
    })

    await news.getTopic('world')

    assert.deepEqual(fake.calls.filter(isFeed), ['https://alpha.example/feed'])
  })

  it('lists only articles that open in the reader, checked in the background', async () => {
    const { news } = setup({
      ...feeds,
      'https://beta.example/sommet': articlePage('Sommet'),
      'https://beta.example/elections': articlePage('Élections')
    })

    const first = await news.getTopic('world')

    assert.deepEqual(first?.items, [])
    assert.equal(first?.checking, 4)

    await news.whenChecksIdle()
    const topic = await news.getTopic('world')

    // Newest first, no old item, no link outside the domains. Alpha's "Sommet" does not open.
    assert.deepEqual(
      topic?.items.map(item => [item.title, item.access]),
      [
        ['Sommet Européen !', 'reader'],
        ['Élections', 'reader']
      ]
    )
    assert.equal(topic?.checking, 0)
    assert.equal(topic?.hasMore, false)

    // "Charger plus": a page of the given size, and whether more articles follow.
    const page = await news.getTopic('world', 1)
    assert.deepEqual(
      page?.items.map(item => item.title),
      ['Sommet Européen !']
    )
    assert.equal(page?.hasMore, true)
    assert.deepEqual(
      topic?.sources.map(source => [source.id, source.ok, source.itemCount]),
      [
        ['alpha', true, 3],
        ['beta', true, 2]
      ]
    )
  })

  it('checks every topic in the background so search finds articles of topics never opened', async () => {
    const logs: string[] = []
    const fake = fakeFetch({
      ...feeds,
      'https://beta.example/sommet': articlePage('Sommet'),
      'https://beta.example/elections': articlePage('Élections')
    })
    const news = new NewsService(catalog, { fetchText: fake.fetchText, now: () => NOW, log: line => logs.push(line) })

    await news.checkAllTopics()
    await news.whenChecksIdle()

    assert.deepEqual(
      (await news.search('élections')).items.map(item => item.title),
      ['Élections']
    )
    const passes = logs.filter(line => line.startsWith('Background'))
    assert.equal(passes.length, 1)
    assert.match(passes[0] ?? '', /^Background checks: 4 articles in 0 s, extraction \d+ ms on average/)
  })

  it('checks what the reader waits for before what the background pass queued', async () => {
    const fake = fakeFetch({
      ...feeds,
      'https://alpha.example/sommet': articlePage('Sommet'),
      'https://beta.example/sommet': articlePage('Sommet'),
      'https://beta.example/elections': articlePage('Élections')
    })
    // Article pages answer only once released, so the queue can be looked at.
    const started: string[] = []
    let release = () => {}
    const released = new Promise<void>(resolve => (release = resolve))
    const news = new NewsService(catalog, {
      fetchText: async url => {
        if (!isFeed(url)) {
          started.push(url)
          await released
        }
        return fake.fetchText(url)
      },
      now: () => NOW,
      log: () => {}
    })

    // Two background checks run at once; the others wait.
    await news.checkAllTopics()
    assert.equal(started.length, 2)

    // The reader opens the topic: what the pass still had queued starts at once
    // (the link outside the source's domains needs no request).
    await news.getTopic('world')
    assert.deepEqual(started.at(-1), 'https://beta.example/elections')
    assert.equal(started.length, 3)

    release()
    await news.whenChecksIdle()
  })

  it('gives feed items without an image the share image of their article page', async () => {
    const { news } = setup({
      ...feeds,
      'https://beta.example/sommet': articlePage('Sommet').replace(
        '<head>',
        '<head><meta property="og:image" content="/images/sommet.jpg">'
      ),
      'https://beta.example/elections': articlePage('Élections')
    })

    await news.getTopic('world')
    await news.whenChecksIdle()
    const topic = await news.getTopic('world')

    assert.deepEqual(
      topic?.items.map(item => [item.title, item.image]),
      [
        ['Sommet Européen !', 'https://beta.example/images/sommet.jpg'],
        ['Élections', null]
      ]
    )
  })

  it('groups the same story from several sources on the newest article', async () => {
    const { news } = setup({
      ...feeds,
      'https://alpha.example/sommet': articlePage('Sommet'),
      'https://beta.example/sommet': articlePage('Sommet'),
      'https://beta.example/elections': articlePage('Élections')
    })

    await news.getTopic('world')
    await news.whenChecksIdle()
    const topic = await news.getTopic('world')

    assert.deepEqual(
      topic?.items.map(item => [item.title, item.related.map(related => [related.sourceName, related.access])]),
      [
        ['Sommet Européen !', [['Alpha', 'reader']]],
        ['Élections', []]
      ]
    )
  })

  it('puts the most covered stories of each topic on the front page', async () => {
    const { news } = setup({
      'https://alpha.example/feed': rssFeed([
        { title: 'Sommet européen', link: 'https://alpha.example/sommet', date: 'Fri, 23 Oct 2026 10:00:00 +0000' },
        { title: 'Fête locale', link: 'https://alpha.example/fete', date: 'Fri, 23 Oct 2026 11:30:00 +0000' }
      ]),
      'https://beta.example/feed': rssFeed([
        { title: 'Sommet  Européen !', link: 'https://beta.example/sommet', date: 'Fri, 23 Oct 2026 11:00:00 +0000' },
        { title: 'Élections', link: 'https://beta.example/elections', date: 'Wed, 21 Oct 2026 08:00:00 +0000' }
      ]),
      'https://alpha.example/sommet': articlePage('Sommet'),
      'https://alpha.example/fete': articlePage('Fête'),
      'https://beta.example/sommet': articlePage('Sommet'),
      'https://beta.example/elections': articlePage('Élections')
    })

    const first = await news.getFrontPage()
    assert.deepEqual(first.sections, [{ id: 'world', label: 'Monde', items: [], checking: 4 }])

    await news.whenChecksIdle()
    const page = await news.getFrontPage()

    // Two sources on the summit: it leads. Too few stories of the last day, so older ones fill in.
    assert.deepEqual(
      page.sections[0]?.items.map(item => item.title),
      ['Sommet Européen !', 'Fête locale', 'Élections']
    )
    assert.equal(page.sections[0]?.checking, 0)

    // A story already seen or read, by any of its articles, steps behind the others.
    const summit = page.sections[0]?.items[0]
    const seenByRelated = await news.getFrontPage(undefined, new Set([summit?.related[0]?.id ?? '']))
    assert.deepEqual(
      seenByRelated.sections[0]?.items.map(item => item.title),
      ['Fête locale', 'Élections', 'Sommet Européen !']
    )
  })

  it('hides unreadable articles and checks the ones that failed again a minute later', async () => {
    const { news, advance } = setup({
      ...feeds,
      'https://beta.example/sommet': new Error('timeout'),
      'https://beta.example/elections': '<html><body><p>Abonnez-vous pour lire la suite.</p></body></html>'
    })

    await news.getTopic('world')
    await news.whenChecksIdle()
    const topic = await news.getTopic('world')

    assert.deepEqual(topic?.items, [])
    // The failed article waits for its retry: it is not reported as being checked.
    assert.equal(topic?.checking, 0)

    advance(2 * 60 * 1000)
    // Both "Sommet" articles failed (Alpha's page is missing): both are checked again.
    assert.equal((await news.getTopic('world'))?.checking, 2)
    await news.whenChecksIdle()
    assert.equal((await news.getArticle(idOf('https://beta.example/sommet'))).status, 'failed')
  })

  it('lists sources without reader as links, without fetching their articles', async () => {
    const linkOnly = parseCatalog(`
topics:
  - id: world
    label: Monde
    sources:
      - id: beta
        name: Beta
        url: https://beta.example/feed
        domains: [beta.example]
        reader: false
`)
    const fake = fakeFetch(feeds)
    const news = new NewsService(linkOnly, { fetchText: fake.fetchText, now: () => NOW, log: () => {} })
    const topic = await news.getTopic('world')

    assert.deepEqual(
      topic?.items.map(item => [item.title, item.access]),
      [
        ['Sommet Européen !', 'link'],
        ['Élections', 'link']
      ]
    )
    assert.equal((await news.getArticle(idOf('https://beta.example/elections'))).status, 'unreadable')
    assert.deepEqual(fake.calls, ['https://beta.example/feed'])
  })

  it('searches the readable articles of every topic, checking the matching ones first', async () => {
    const { news, calls } = setup({
      ...feeds,
      'https://beta.example/sommet': articlePage('Sommet'),
      'https://beta.example/elections': articlePage('Élections')
    })

    // Nothing checked yet: only the matching article is checked, then found.
    const first = await news.search('elections')
    assert.deepEqual(first, { items: [], checking: 1 })
    await news.whenChecksIdle()
    assert.deepEqual(
      calls.filter(url => !isFeed(url)),
      ['https://beta.example/elections']
    )

    await news.getTopic('world')
    await news.whenChecksIdle()

    // Case and accents do not matter; every word must match.
    assert.deepEqual(
      (await news.search('  ÉLECTIONS ')).items.map(item => [item.title, item.topicLabel]),
      [['Élections', 'Monde']]
    )
    assert.deepEqual(
      (await news.search('sommet européen')).items.map(item => item.title),
      ['Sommet Européen !']
    )
    assert.deepEqual((await news.search('sommet élections')).items, [])
    // Words are found at their start only.
    assert.deepEqual((await news.search('lections')).items, [])
    assert.deepEqual(await news.search('   '), { items: [], checking: 0 })
  })

  it('returns null for an unknown topic', async () => {
    assert.equal(await setup(feeds).news.getTopic('nope'), null)
  })

  it('serves feeds from memory for 15 minutes', async () => {
    const { news, calls, advance } = setup(feeds)

    await news.getTopic('world')
    advance(14 * 60 * 1000)
    await news.getTopic('world')
    assert.equal(calls.filter(isFeed).length, 2)

    advance(2 * 60 * 1000)
    await news.getTopic('world')
    assert.equal(calls.filter(isFeed).length, 4)
  })

  it('fetches the feeds again on demand, at most once a minute', async () => {
    const { news, calls, advance } = setup(feeds)

    await news.getTopic('world')
    await news.getTopic('world', TOPIC_PAGE_SIZE, { fresh: true })
    assert.equal(calls.filter(isFeed).length, 2)

    advance(61 * 1000)
    await news.getTopic('world', TOPIC_PAGE_SIZE, { fresh: true })
    assert.equal(calls.filter(isFeed).length, 4)
  })

  it('keeps the last items when a refresh fails, and reports the error', async () => {
    const responses: Record<string, FakeResponse> = { ...feeds }
    const { news, advance } = setup(responses)

    await news.getTopic('world')
    responses['https://alpha.example/feed'] = new Error('HTTP 503')
    advance(16 * 60 * 1000)

    const topic = await news.getTopic('world')
    const alpha = topic?.sources.find(source => source.id === 'alpha')

    assert.equal(alpha?.ok, false)
    assert.equal(alpha?.error, 'HTTP 503')
    assert.equal(alpha?.itemCount, 3)
  })

  it('opens articles listed by a feed in reader mode', async () => {
    const { news } = setup({ ...feeds, 'https://beta.example/elections': articlePage('Élections') })
    await news.getTopic('world')

    const result = await news.getArticle(idOf('https://beta.example/elections'))

    assert.equal(result.status, 'ok')
    assert.match(result.status === 'ok' ? result.article.contentHtml : '', /Paragraph 8/)
  })

  it('tells its listener of each article read from its site, once', async () => {
    const { news } = setup({ ...feeds, 'https://beta.example/elections': articlePage('Élections') })
    const heard: string[] = []
    news.setArticleListener(result => heard.push(result.status))
    await news.getTopic('world')
    await news.whenChecksIdle()
    heard.length = 0

    const id = idOf('https://beta.example/elections')
    news.setArticleListener(result => heard.push(`${result.status} ${'item' in result ? result.item.id : ''}`))
    await news.getArticle(id)
    await news.getArticle(id)

    // Read in the background already: the reader's second look tells nothing new.
    assert.deepEqual(heard, [])
    assert.deepEqual(await news.getArticle('AAAAAAAAAAAAAAAA'), { status: 'unknown' })
    assert.deepEqual(heard, [])
  })

  it('tells its listener of an article the reader opens first, and a failing listener changes nothing', async () => {
    const { news } = setup({ ...feeds, 'https://beta.example/elections': articlePage('Élections') })
    const heard: string[] = []
    news.setArticleListener(result => {
      heard.push(result.status)
      throw new Error('a plugin went wrong')
    })
    await news.getTopic('world')
    const result = await news.getArticle(idOf('https://beta.example/elections'))

    assert.equal(result.status, 'ok')
    assert.ok(heard.includes('ok'))
  })

  it('fetches an article page again for plugins, only from its source', async () => {
    const { news } = setup({ ...feeds, 'https://beta.example/elections': articlePage('Élections') })
    await news.getTopic('world')

    const page = await news.fetchArticlePage(idOf('https://beta.example/elections'))
    assert.equal(page?.url, 'https://beta.example/elections')
    assert.match(page?.html ?? '', /Paragraph 8/)
    assert.equal(await news.fetchArticlePage(idOf('https://other.example/x')), null)
    assert.equal(await news.fetchArticlePage('AAAAAAAAAAAAAAAA'), null)
  })

  it('takes out the blocks a source repeats in its other stored articles', async () => {
    const page = (title: string) => `<!doctype html><html><head><title>${title}</title></head><body><article>
      <h1>${title}</h1>
      ${Array.from({ length: 6 }, (_, index) => `<p>${title}, paragraph ${index + 1}: what happened, who said what and why it matters for the readers of this article.</p>`).join('\n')}
      <p>Suivez-nous sur WhatsApp pour recevoir chaque jour un condensé de l’actualité.</p>
      </article></body></html>`
    const fake = fakeFetch({
      ...feeds,
      'https://beta.example/elections': page('Élections'),
      'https://beta.example/sommet': page('Sommet')
    })
    const store = new NewsStore(openDatabase(':memory:'))
    let clock = NOW
    const news = new NewsService(catalog, { fetchText: fake.fetchText, store, now: () => clock, log: () => {} })
    await news.getTopic('world')
    await news.whenChecksIdle()
    // Past the articles kept in memory by the checks, so each one is served from the store.
    clock += 60 * 60 * 1000
    const html = async (link: string) => {
      const result = await news.getArticle(idOf(link))
      return result.status === 'ok' ? result.article.contentHtml : ''
    }

    const second = await html('https://beta.example/sommet')
    assert.doesNotMatch(second, /Suivez-nous/)
    assert.match(second, /Sommet, paragraph 6/)
    // Stored as extracted, so it can still be compared later.
    assert.match(store.getContent(idOf('https://beta.example/sommet'))?.contentHtml ?? '', /Suivez-nous/)
  })

  it("names topics in the reader's language", async () => {
    const named = parseCatalog(
      `
topics:
  - id: world
    label: { fr: Monde, en: World }
    sources:
      - id: alpha
        name: Alpha
        url: https://alpha.example/feed
        domains: [alpha.example]
`
    )
    const fake = fakeFetch({ ...feeds, 'https://alpha.example/sommet': articlePage('Sommet') })
    const news = new NewsService(named, { fetchText: fake.fetchText, now: () => NOW, log: () => {} })

    assert.equal((await news.getTopic('world'))?.label, 'Monde')
    await news.whenChecksIdle()
    assert.equal((await news.getTopic('world', undefined, { language: 'en' }))?.label, 'World')
    assert.equal((await news.getFrontPage(undefined, undefined, 'en')).sections[0]?.label, 'World')
    const day = await news.getDay('2026-10-23', 'Europe/Brussels', null, 'en')
    assert.ok(day && day.items.length > 0 && day.items.every(item => item.topicLabel === 'World'))
    const found = await news.search('sommet', 'en')
    assert.ok(found.items.length > 0 && found.items.every(item => item.topicLabel === 'World'))
  })

  it("leaves a profile's hidden topics out of Le fil, keeping an article that a shown topic also has", async () => {
    // Alpha is in both topics, as a source added under two themes is.
    const [world] = catalog.topics
    const alpha = world?.sources.find(source => source.id === 'alpha')
    assert.ok(world && alpha)
    const shared = { ...catalog, topics: [world, { ...world, id: 'tech', label: 'Tech', sources: [alpha] }] }
    const fake = fakeFetch({
      ...feeds,
      'https://alpha.example/sommet': articlePage('Sommet'),
      'https://beta.example/elections': articlePage('Élections')
    })
    const news = new NewsService(shared, { fetchText: fake.fetchText, now: () => NOW, log: () => {} })
    await news.getDay('2026-10-23', 'Europe/Brussels')
    await news.whenChecksIdle()

    const all = await news.getDay('2026-10-23', 'Europe/Brussels')
    assert.ok(all?.items.some(item => item.sourceId === 'beta'))
    const withoutWorld = await news.getDay('2026-10-23', 'Europe/Brussels', null, 'fr', ['world'])
    assert.ok(withoutWorld && withoutWorld.items.length > 0)
    assert.ok(withoutWorld.items.every(item => item.topicId === 'tech' && item.sourceId === 'alpha'))
    const none = await news.getDay('2026-10-23', 'Europe/Brussels', null, 'fr', ['world', 'tech'])
    assert.deepEqual(none?.items, [])
    // One topic asked by its id is listed even when hidden: only Le fil leaves it out.
    assert.ok((await news.getDay('2026-10-23', 'Europe/Brussels', 'world', 'fr', ['world']))?.items.length)
  })

  describe('summaries', () => {
    const dailySummarySetup = (summarize: (input: SummaryInput) => Promise<string[]>, now = () => NOW) => {
      const fake = fakeFetch({ ...feeds, 'https://beta.example/elections': articlePage('Élections') })
      return new NewsService(catalog, {
        fetchText: fake.fetchText,
        summarize,
        now,
        log: () => {}
      })
    }

    it('summarizes an article once and shares the result', async () => {
      const inputs: SummaryInput[] = []
      const news = dailySummarySetup(async input => {
        inputs.push(input)
        return ['Un point.', 'Un autre.']
      })
      await news.getTopic('world')
      const id = idOf('https://beta.example/elections')

      const [first, second] = await Promise.all([news.getSummary(id), news.getSummary(id)])

      assert.deepEqual(first, { status: 'ok', points: ['Un point.', 'Un autre.'] })
      assert.deepEqual(second, first)
      assert.deepEqual(await news.getSummary(id), first)
      assert.equal(inputs.length, 1)
      assert.equal(inputs[0]?.title, 'Élections')
      assert.equal(inputs[0]?.sourceName, 'Beta')
      assert.equal(news.canSummarize(), true)
    })

    it("writes in the profile's language, one summary per article and language", async () => {
      const inputs: SummaryInput[] = []
      const languages: Record<number, 'fr' | 'en'> = { 1: 'fr', 2: 'en' }
      const fake = fakeFetch({ ...feeds, 'https://beta.example/elections': articlePage('Élections') })
      const news = new NewsService(catalog, {
        fetchText: fake.fetchText,
        summarize: async input => {
          inputs.push(input)
          return [input.language === 'en' ? 'A point.' : 'Un point.']
        },
        languageOf: profileId => languages[profileId] ?? 'fr',
        now: () => NOW,
        log: () => {}
      })
      await news.getTopic('world')
      const id = idOf('https://beta.example/elections')

      assert.deepEqual(await news.getSummary(id, 1), { status: 'ok', points: ['Un point.'] })
      assert.deepEqual(await news.getSummary(id, 2), { status: 'ok', points: ['A point.'] })
      // Each language paid for once: asked again, both are shared.
      assert.deepEqual(await news.getSummary(id, 2), { status: 'ok', points: ['A point.'] })
      assert.deepEqual(await news.getSummary(id, 1), { status: 'ok', points: ['Un point.'] })
      assert.deepEqual(
        inputs.map(input => input.language),
        ['fr', 'en']
      )
    })

    it('reports missing keys, unknown or unreadable articles, refusals and failures', async () => {
      const plain = new NewsService(catalog, { fetchText: fakeFetch(feeds).fetchText, now: () => NOW, log: () => {} })
      assert.equal(plain.canSummarize(), false)
      assert.deepEqual(await plain.getSummary(idOf('https://beta.example/elections')), { status: 'unavailable' })

      let calls = 0
      const news = dailySummarySetup(async () => {
        calls++
        throw calls === 1 ? new SummaryRefusedError('no') : new Error('API down')
      })
      await news.getTopic('world')
      const id = idOf('https://beta.example/elections')

      assert.deepEqual(await news.getSummary('AAAAAAAAAAAAAAAA'), { status: 'unknown' })
      assert.deepEqual(await news.getSummary(idOf('https://beta.example/sommet')), { status: 'failed' })
      assert.deepEqual(await news.getSummary(id), { status: 'refused' })
      // A failed summary is asked again next time.
      assert.deepEqual(await news.getSummary(id), { status: 'failed' })
      assert.equal(calls, 2)
    })

    it('never stops calling the API, and counts each reader’s calls apart', async () => {
      let calls = 0
      const clock = spacedClock()
      const news = dailySummarySetup(async () => {
        calls++
        throw new Error('API down')
      }, clock.now)
      await news.getTopic('world')
      const id = idOf('https://beta.example/elections')

      for (let attempt = 0; attempt < MANY; attempt++) {
        await news.getSummary(id, 1)
        clock.next()
      }
      assert.equal(calls, MANY)
      // Another reader pays with its own key: its calls are its own.
      await news.getSummary(id, 2)
      assert.equal(calls, MANY + 1)

      assert.deepEqual(
        news.aiUsage(1).kinds.find(kind => kind.kind === 'summary'),
        { kind: 'summary', used: MANY }
      )
      assert.equal(news.aiUsage(2).kinds.find(kind => kind.kind === 'summary')!.used, 1)
    })

    it('stops a runaway: past 30 calls in a minute, nothing is sent until the minute has passed', async () => {
      let calls = 0
      let at = NOW
      const news = dailySummarySetup(
        async () => {
          calls++
          throw new Error('API down')
        },
        () => at
      )
      await news.getTopic('world')
      const id = idOf('https://beta.example/elections')

      for (let attempt = 0; attempt < AI_CALLS_PER_MINUTE; attempt++) await news.getSummary(id, 1)
      assert.deepEqual(await news.getSummary(id, 1), { status: 'limited' })
      assert.equal(calls, AI_CALLS_PER_MINUTE)
      // Not counted: nothing was sent.
      assert.equal(news.aiUsage(1).kinds.find(kind => kind.kind === 'summary')!.used, AI_CALLS_PER_MINUTE)
      // Someone else is not held back.
      await news.getSummary(id, 2)
      assert.equal(calls, AI_CALLS_PER_MINUTE + 1)

      at += 60_000
      await news.getSummary(id, 1)
      assert.equal(calls, AI_CALLS_PER_MINUTE + 2)
    })

    it("uses each reader's own key, and none for a reader without one", async () => {
      let dupontCalls = 0
      const fake = fakeFetch({ ...feeds, 'https://beta.example/elections': articlePage('Élections') })
      const unused = async () => {
        throw new Error('unused')
      }
      const tools = (summarize: AiTools['summarize']): AiTools => ({
        summarize,
        writeDailySummary: unused,
        answerQuestion: unused,
        suggestSources: unused
      })
      // Reader 1's key fails, reader 2's works, reader 3 (a young profile, no account) has none.
      const failing = tools(async () => {
        dupontCalls++
        throw new Error('API down')
      })
      const working = tools(async () => ['Un point.'])
      const news = new NewsService(catalog, {
        fetchText: fake.fetchText,
        aiOf: profileId => (profileId === 1 ? failing : profileId === 2 ? working : null),
        now: () => NOW,
        log: () => {}
      })
      await news.getTopic('world')
      const id = idOf('https://beta.example/elections')

      assert.deepEqual(await news.getSummary(id, 1), { status: 'failed' })
      assert.deepEqual(await news.getSummary(id, 2), { status: 'ok', points: ['Un point.'] })
      assert.deepEqual(await news.getSummary(id, 3), { status: 'unavailable' })
      assert.equal(dupontCalls, 1)
      assert.deepEqual(
        [1, 2, 3].map(profileId => news.canSummarize(profileId)),
        [true, true, false]
      )
      assert.equal(news.aiUsage(3).available, false)
    })

    it('sends the article as plain text, one paragraph per block', () => {
      assert.equal(
        articleText('<h2>Titre</h2><p>Un  <b>paragraphe</b>.</p><ul><li>Point</li></ul>'),
        'Titre\n\nUn paragraphe.\n\nPoint'
      )
    })
  })

  describe('questions', () => {
    it('answers questions about an article, with no daily cap', async () => {
      const asked: string[] = []
      const clock = spacedClock()
      const fake = fakeFetch({ ...feeds, 'https://beta.example/elections': articlePage('Élections') })
      const news = new NewsService(catalog, {
        fetchText: fake.fetchText,
        answerQuestion: async ({ title, question }) => {
          asked.push(question)
          if (question === 'refus') throw new SummaryRefusedError('no')
          return { answer: `${title} : réponse.`, sources: [{ url: 'https://wiki.example/x', title: 'X' }] }
        },
        now: clock.now,
        log: () => {}
      })
      await news.getTopic('world')
      const id = idOf('https://beta.example/elections')

      assert.deepEqual(await news.answerQuestion(id, 'Qui ?'), {
        status: 'ok',
        answer: 'Élections : réponse.',
        sources: [{ url: 'https://wiki.example/x', title: 'X' }]
      })
      assert.deepEqual(await news.answerQuestion(id, 'refus'), { status: 'refused' })
      assert.deepEqual(await news.answerQuestion('AAAAAAAAAAAAAAAA', 'Qui ?'), { status: 'unknown' })

      for (let attempt = 2; attempt < MANY; attempt++) {
        await news.answerQuestion(id, 'Encore ?')
        clock.next()
      }
      assert.equal((await news.answerQuestion(id, 'Encore une ?')).status, 'ok')
      assert.equal(asked.length, MANY + 1)
      assert.equal((await news.answerQuestion(id, 'Et Léa ?', 2)).status, 'ok')
    })
  })

  describe('plugin questions', () => {
    const QUESTION = { system: '', prompt: 'Résume', maxTokens: 100 }

    it('asks for a plugin with no daily cap, and counts each plugin', async () => {
      const asked: unknown[] = []
      const db = openDatabase(':memory:')
      const clock = spacedClock()
      let ai: AiTools | null = null
      const news = new NewsService(catalog, {
        fetchText: fakeFetch(feeds).fetchText,
        aiOf: () => ai,
        store: new NewsStore(db),
        now: clock.now,
        log: () => {}
      })
      assert.deepEqual(await news.askForPlugin('helper', 1, QUESTION), { status: 'unavailable' })
      assert.equal(news.pluginAiLeft(1), false)

      ai = {
        askForPlugin: async (question: unknown) => {
          asked.push(question)
          return 'Oui.'
        }
      } as unknown as AiTools
      assert.equal(news.pluginAiLeft(1), true)
      assert.deepEqual(await news.askForPlugin('helper', 1, QUESTION), { status: 'ok', text: 'Oui.' })
      assert.deepEqual(asked, [QUESTION])
      for (let call = 1; call < MANY; call++) {
        await news.askForPlugin('other', 1, QUESTION)
        clock.next()
      }
      // No daily cap: only the plugin's own hourly one (plugins/ai.ts) stops it.
      assert.equal(news.pluginAiLeft(1), true)
      assert.deepEqual(await news.askForPlugin('helper', 1, QUESTION), { status: 'ok', text: 'Oui.' })
      assert.equal(asked.length, MANY + 1)
      assert.deepEqual(news.pluginAiCalls(1), { helper: 2, other: MANY - 1 })
      // Recorded with the plugin that asked, across a restart.
      assert.deepEqual(
        new NewsStore(db)
          .aiCalls(0)
          .filter(call => call.kind === 'plugin')
          .map(call => call.pluginId)
          .slice(0, 2),
        ['helper', 'other']
      )
    })

    it('tells a refusal from a failure', async () => {
      let error: Error = new SummaryRefusedError()
      const ai = {
        askForPlugin: async () => {
          throw error
        }
      } as unknown as AiTools
      const news = new NewsService(catalog, {
        fetchText: fakeFetch(feeds).fetchText,
        aiOf: () => ai,
        now: () => NOW,
        log: () => {}
      })
      assert.deepEqual(await news.askForPlugin('helper', 1, QUESTION), { status: 'refused' })
      error = new Error('overloaded')
      assert.deepEqual(await news.askForPlugin('helper', 1, QUESTION), { status: 'failed' })
    })
  })

  describe('source suggestions', () => {
    it('asks for sites in a topic, with no daily cap', async () => {
      const asked: { topic: string; replacing: string | null }[] = []
      const clock = spacedClock()
      const news = new NewsService(catalog, {
        fetchText: fakeFetch(feeds).fetchText,
        suggestSources: async ({ topic, replacing }) => {
          asked.push({ topic, replacing })
          return [{ name: 'Gamma', url: 'https://gamma.example/', reason: 'Sérieux.' }]
        },
        now: clock.now,
        log: () => {}
      })

      assert.deepEqual(await news.suggestSources('world', 1, { current: ['Alpha'], replacing: 'Beta' }), {
        status: 'ok',
        sites: [{ name: 'Gamma', url: 'https://gamma.example/', reason: 'Sérieux.' }]
      })
      assert.deepEqual(asked, [{ topic: 'Monde', replacing: 'Beta' }])
      assert.deepEqual(await news.suggestSources('nope', 1, { current: [], replacing: null }), { status: 'not_found' })

      for (let call = 1; call < MANY; call++) {
        await news.suggestSources('world', 1, { current: [], replacing: null })
        clock.next()
      }
      assert.equal((await news.suggestSources('world', 1, { current: [], replacing: null })).status, 'ok')
      assert.equal(asked.length, MANY + 1)
    })

    it("asks in the profile's language, for sites in it and in the household's", async () => {
      const asked: { language: string; languages: string[] }[] = []
      const languages: Record<number, 'fr' | 'en'> = { 1: 'fr', 2: 'en' }
      const news = new NewsService(catalog, {
        fetchText: fakeFetch(feeds).fetchText,
        languageOf: profileId => languages[profileId] ?? 'fr',
        householdLanguage: () => 'fr',
        suggestSources: async ({ language, languages }) => {
          asked.push({ language, languages })
          return []
        },
        now: () => NOW,
        log: () => {}
      })

      await news.suggestSources('world', 1, { current: [], replacing: null })
      await news.suggestSources('world', 2, { current: [], replacing: null })
      assert.deepEqual(asked, [
        { language: 'fr', languages: ['fr'] },
        { language: 'en', languages: ['en', 'fr'] }
      ])
    })
  })

  describe('daily summary', () => {
    const dailySummarySetup = (
      writeDailySummary: (stories: DailySummaryStory[]) => Promise<{ topic: string; text: string }[]>
    ) => {
      let clock = NOW
      const fake = fakeFetch({
        ...feeds,
        'https://beta.example/sommet': articlePage('Sommet'),
        'https://beta.example/elections': articlePage('Élections')
      })
      const news = new NewsService(catalog, {
        fetchText: fake.fetchText,
        writeDailySummary,
        // Midnight in Brussels ends the day's daily summary.
        timeZone: 'Europe/Brussels',
        now: () => clock,
        log: () => {}
      })
      // Writes once the feeds fetched again by the front page are checked.
      const writeSettled = async () => {
        await news.getFrontPage()
        await news.whenChecksIdle()
        return news.writeDailySummary()
      }
      return { news, writeSettled, advance: (ms: number) => (clock += ms) }
    }

    it('writes each profile its own daily summary, from what it reads', async () => {
      const calls: DailySummaryStory[][] = []
      const { news, writeSettled } = dailySummarySetup(async stories => {
        calls.push(stories)
        return [{ topic: 'Monde', text: `Pour ${calls.length}.` }]
      })
      await writeSettled()

      const lea = await news.writeDailySummary(2, {
        hiddenSources: ['alpha'],
        hiddenTopics: [],
        mutedWords: ['elections']
      })

      assert.equal(lea.status === 'ok' && lea.points[0]?.text, 'Pour 2.')
      assert.equal(calls[0]!.length, 2)
      // The election muted (accents aside): only the summit reaches Léa's daily summary.
      assert.deepEqual(
        calls[1]!.map(story => story.title),
        ['Sommet Européen !']
      )
      assert.equal((news.getDailySummary(1) as { points: { text: string }[] }).points[0]?.text, 'Pour 1.')
      assert.equal((news.getDailySummary(2) as { points: { text: string }[] }).points[0]?.text, 'Pour 2.')
      assert.deepEqual(news.getDailySummary(3), { status: 'none' })
    })

    it("writes in the profile's language, and a daily summary in another one counts as none", async () => {
      const languages: ('fr' | 'en')[] = []
      let language: 'fr' | 'en' = 'fr'
      const fake = fakeFetch({
        ...feeds,
        'https://beta.example/sommet': articlePage('Sommet'),
        'https://beta.example/elections': articlePage('Élections')
      })
      const news = new NewsService(catalog, {
        fetchText: fake.fetchText,
        writeDailySummary: async (_stories, written) => {
          languages.push(written)
          return [{ topic: 'Monde', text: written === 'en' ? 'In English.' : 'En français.' }]
        },
        languageOf: () => language,
        timeZone: 'Europe/Brussels',
        now: () => NOW,
        log: () => {}
      })
      await news.getFrontPage()
      await news.whenChecksIdle()

      assert.equal((await news.writeDailySummary()).status, 'ok')
      assert.equal((news.getDailySummary() as { points: { text: string }[] }).points[0]?.text, 'En français.')

      // The profile switched to English: the French daily summary is not shown, and a click writes it again at once.
      language = 'en'
      assert.deepEqual(news.getDailySummary(), { status: 'none' })
      const written = await news.writeDailySummary()
      assert.equal(written.status === 'ok' && written.points[0]?.text, 'In English.')
      assert.deepEqual(languages, ['fr', 'en'])
    })

    it('writes the daily summary only on request, then shares it', async () => {
      const calls: DailySummaryStory[][] = []
      const { news, writeSettled, advance } = dailySummarySetup(async stories => {
        calls.push(stories)
        return [
          { topic: 'Ailleurs', text: 'Hors liste.' },
          { topic: 'Monde', text: `Version ${calls.length}.` }
        ]
      })

      // Reading never writes one.
      assert.deepEqual(news.getDailySummary(), { status: 'none' })
      // The front page is still being checked: nothing to sum up yet.
      assert.deepEqual(await news.writeDailySummary(), { status: 'pending' })
      await news.whenChecksIdle()

      const [first, second] = await Promise.all([news.writeDailySummary(), news.writeDailySummary()])
      assert.deepEqual(first, {
        status: 'ok',
        points: [
          { topic: 'Monde', topicId: 'world', text: 'Version 1.' },
          { topic: 'Ailleurs', topicId: null, text: 'Hors liste.' }
        ],
        generatedAt: new Date(NOW).toISOString()
      })
      assert.deepEqual(second, first)
      assert.deepEqual(news.getDailySummary(), first)
      assert.equal(calls.length, 1)
      assert.deepEqual(
        calls[0]?.map(story => [story.topicId, story.topic, story.title, story.coverage]),
        [
          ['world', 'Monde', 'Sommet Européen !', 1],
          ['world', 'Monde', 'Élections', 1]
        ]
      )

      // Asked again right away: the same daily summary, at no cost.
      advance(10 * 60 * 1000)
      assert.deepEqual(await news.writeDailySummary(), first)
      assert.equal(calls.length, 1)

      advance(60 * 60 * 1000)
      const later = await writeSettled()
      assert.equal(later.status === 'ok' && later.points[0]?.text, 'Version 2.')

      // Past midnight in Belgium (NOW is 14:00 there, the daily summary was written at 15:10), yesterday's is gone.
      assert.equal(news.getDailySummary().status, 'ok')
      advance(8 * 60 * 60 * 1000)
      assert.equal(news.getDailySummary().status, 'ok')
      advance(60 * 60 * 1000)
      assert.deepEqual(news.getDailySummary(), { status: 'none' })
    })

    it('keeps the last daily summary when writing a new one fails, however often it fails', async () => {
      let calls = 0
      const { news, writeSettled, advance } = dailySummarySetup(async () => {
        calls++
        if (calls > 1) throw new Error('API down')
        return [{ topic: 'Monde', text: 'Le seul.' }]
      })
      await news.getTopic('world')
      await news.whenChecksIdle()

      const first = await news.writeDailySummary()
      advance(60 * 60 * 1000)
      assert.deepEqual(await writeSettled(), first)

      for (let attempt = 0; attempt < 10; attempt++) assert.deepEqual(await writeSettled(), first)
      assert.equal(calls, 12)
    })

    it('is unavailable without an API key', async () => {
      const news = new NewsService(catalog, { fetchText: fakeFetch(feeds).fetchText, now: () => NOW, log: () => {} })
      assert.deepEqual(news.getDailySummary(), { status: 'unavailable' })
      assert.deepEqual(await news.writeDailySummary(), { status: 'unavailable' })
    })
  })

  it('never fetches unknown ids or links outside the source domains', async () => {
    const { news, calls } = setup(feeds)
    await news.getTopic('world')
    await news.whenChecksIdle()

    assert.deepEqual(await news.getArticle('AAAAAAAAAAAAAAAA'), { status: 'unknown' })
    assert.equal((await news.getArticle(idOf('https://other.example/x'))).status, 'unreadable')
    assert.equal(
      calls.some(url => url.startsWith('https://other.example')),
      false
    )
  })

  it('refuses redirects that leave the source domains', async () => {
    const { news } = setup({
      ...feeds,
      'https://beta.example/elections': { redirectTo: 'https://paywall.example/login', text: articlePage('Login') }
    })
    await news.getTopic('world')

    assert.equal((await news.getArticle(idOf('https://beta.example/elections'))).status, 'unreadable')
  })

  it('reports short pages as unreadable and network errors as failed', async () => {
    const { news } = setup({
      ...feeds,
      'https://beta.example/elections': '<html><body><p>Abonnez-vous pour lire la suite.</p></body></html>',
      'https://beta.example/sommet': new Error('timeout')
    })
    await news.getTopic('world')

    assert.equal((await news.getArticle(idOf('https://beta.example/elections'))).status, 'unreadable')
    assert.equal((await news.getArticle(idOf('https://beta.example/sommet'))).status, 'failed')
  })

  it('falls back to the full text of the feed when the article page is blocked', async () => {
    const fake = fakeFetch({
      'https://alpha.example/feed': rssFeed([
        {
          title: 'Bloqué',
          link: 'https://alpha.example/bloque',
          date: 'Fri, 23 Oct 2026 10:00:00 +0000',
          content: articleBody()
        },
        {
          title: 'Résumé seul',
          link: 'https://alpha.example/resume',
          date: 'Fri, 23 Oct 2026 09:00:00 +0000',
          content: '<p>Trop court.</p>'
        }
      ]),
      'https://alpha.example/bloque': new Error('HTTP 403'),
      'https://alpha.example/resume': new Error('HTTP 403'),
      'https://beta.example/feed': rssFeed([])
    })
    const news = new NewsService(catalog, { fetchText: fake.fetchText, now: () => NOW, log: () => {} })
    await news.getTopic('world')

    const blocked = await news.getArticle(idOf('https://alpha.example/bloque'))

    assert.equal(blocked.status, 'ok')
    assert.match(blocked.status === 'ok' ? blocked.article.contentHtml : '', /Paragraph 8/)
    assert.equal((await news.getArticle(idOf('https://alpha.example/resume'))).status, 'failed')
  })
})

describe('NewsService.getListen', () => {
  const listenCatalog = parseCatalog(`
topics: []
listen:
  - id: science
    label: Science
    sources:
      - id: yt-test
        name: Test
        url: https://www.youtube.com/feeds/videos.xml?channel_id=UC123
`)

  const entry = (videoId: string, title: string, published: string) =>
    `<entry><yt:videoId>${videoId}</yt:videoId><title>${title}</title><link rel="alternate" href="https://www.youtube.com/watch?v=${videoId}"/><published>${published}</published></entry>`

  it('groups videos by section and leaves out those older than 60 days', async () => {
    const fake = fakeFetch({
      'https://www.youtube.com/feeds/videos.xml?channel_id=UC123': `<?xml version="1.0"?>
        <feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015">
          ${entry('aaaaaaaaaaa', 'Récente', '2026-10-20T10:00:00+00:00')}
          ${entry('bbbbbbbbbbb', 'Il y a 50 jours', '2026-09-03T10:00:00+00:00')}
          ${entry('ccccccccccc', 'Trop vieille', '2026-08-01T10:00:00+00:00')}
        </feed>`
    })
    const news = new NewsService(listenCatalog, { fetchText: fake.fetchText, now: () => NOW, log: () => {} })
    const listen = await news.getListen()

    assert.deepEqual(
      listen.sections.map(section => [section.label, section.items.map(item => item.title)]),
      [['Science', ['Récente', 'Il y a 50 jours']]]
    )
  })

  it('keeps videos as many days as Serveur › Contenu says', async () => {
    const fake = fakeFetch({
      'https://www.youtube.com/feeds/videos.xml?channel_id=UC123': `<?xml version="1.0"?>
        <feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015">
          ${entry('aaaaaaaaaaa', 'Récente', '2026-10-20T10:00:00+00:00')}
          ${entry('bbbbbbbbbbb', 'Il y a 50 jours', '2026-09-03T10:00:00+00:00')}
          ${entry('ccccccccccc', 'Il y a 90 jours', '2026-08-01T10:00:00+00:00')}
        </feed>`
    })
    let videoDays = 30
    const news = new NewsService(listenCatalog, {
      fetchText: fake.fetchText,
      windows: () => ({ articleDays: 3, videoDays }),
      now: () => NOW,
      log: () => {}
    })
    const titles = async () =>
      (await news.getListen()).sections.flatMap(section => section.items.map(item => item.title))
    assert.deepEqual(await titles(), ['Récente'])
    videoDays = 120
    assert.deepEqual(await titles(), ['Récente', 'Il y a 50 jours', 'Il y a 90 jours'])
  })

  it('adds the lengths read from the video pages on the next visit, and leaves out short ones', async () => {
    const fake = fakeFetch({
      'https://www.youtube.com/feeds/videos.xml?channel_id=UC123': `<?xml version="1.0"?>
        <feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015">
          ${entry('aaaaaaaaaaa', 'Longue', '2026-10-20T10:00:00+00:00')}
          ${entry('bbbbbbbbbbb', 'Short', '2026-10-20T09:00:00+00:00')}
          ${entry('ccccccccccc', 'Inconnue', '2026-10-20T08:00:00+00:00')}
        </feed>`
    })
    const lengths: Record<string, number | null> = { aaaaaaaaaaa: 754, bbbbbbbbbbb: 45, ccccccccccc: null }
    const asked: string[] = []
    const store = new NewsStore(openDatabase(':memory:'))
    const news = new NewsService(listenCatalog, {
      fetchText: fake.fetchText,
      fetchVideoDuration: async id => {
        asked.push(id)
        return lengths[id] ?? null
      },
      store,
      now: () => NOW,
      log: () => {}
    })

    const first = await news.getListen()
    assert.deepEqual(
      first.sections[0]?.items.map(item => item.title),
      ['Longue', 'Short', 'Inconnue']
    )

    await new Promise(resolve => setImmediate(resolve))
    const second = await news.getListen()
    assert.deepEqual(
      second.sections[0]?.items.map(item => [
        item.title,
        item.media?.type === 'youtube' ? item.media.durationSeconds : 0
      ]),
      [
        ['Longue', 754],
        ['Inconnue', undefined]
      ]
    )
    // Each page is read once; one without a length waits an hour.
    assert.deepEqual(asked, ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'])
  })

  it('lists a seen video in the history, under its section', async () => {
    const fake = fakeFetch({
      'https://www.youtube.com/feeds/videos.xml?channel_id=UC123': `<?xml version="1.0"?>
        <feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015">
          ${entry('aaaaaaaaaaa', 'Vue', '2026-10-20T10:00:00+00:00')}
        </feed>`
    })
    const news = new NewsService(listenCatalog, { fetchText: fake.fetchText, now: () => NOW, log: () => {} })
    const video = (await news.getListen()).sections[0]?.items[0]

    assert.deepEqual(
      news.history([video?.id ?? '']).map(item => [item.title, item.kind, item.topicLabel]),
      [['Vue', 'video', 'Science']]
    )
  })
})

describe('parseVideoDuration', () => {
  it('reads the player data, or the page microdata', () => {
    assert.equal(parseVideoDuration('{"videoDetails":{"lengthSeconds":"754","x":1}}'), 754)
    assert.equal(parseVideoDuration('<meta itemprop="duration" content="PT1H2M3S">'), 3723)
    assert.equal(parseVideoDuration('<meta itemprop="duration" content="PT12M">'), 720)
    assert.equal(parseVideoDuration('<html>nothing</html>'), null)
  })
})
