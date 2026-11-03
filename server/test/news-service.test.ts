import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseCatalog } from '../news/catalog.ts'
import { AI_CAPS, NewsService, TOPIC_PAGE_SIZE, profileCap } from '../news/news-service.ts'
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
  - id: monde
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

// Two profiles share the AI caps: the admin (1) and another one (2).
const HOUSEHOLD = () => [
  { id: 1, admin: true },
  { id: 2, admin: false }
]
const capOf = (kind: keyof typeof AI_CAPS, profileId = 1) => profileCap(AI_CAPS[kind], HOUSEHOLD(), profileId)

describe('NewsService', () => {
  it('does not fetch a source every profile turned off', async () => {
    const fake = fakeFetch(feeds)
    const news = new NewsService(catalog, {
      fetchText: fake.fetchText,
      isPaused: id => id === 'beta',
      now: () => NOW,
      log: () => {}
    })

    await news.getTopic('monde')

    assert.deepEqual(fake.calls.filter(isFeed), ['https://alpha.example/feed'])
  })

  it('lists only articles that open in the reader, checked in the background', async () => {
    const { news } = setup({
      ...feeds,
      'https://beta.example/sommet': articlePage('Sommet'),
      'https://beta.example/elections': articlePage('Élections')
    })

    const first = await news.getTopic('monde')

    assert.deepEqual(first?.items, [])
    assert.equal(first?.checking, 4)

    await news.whenChecksIdle()
    const topic = await news.getTopic('monde')

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
    const page = await news.getTopic('monde', 1)
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
    await news.getTopic('monde')
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

    await news.getTopic('monde')
    await news.whenChecksIdle()
    const topic = await news.getTopic('monde')

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

    await news.getTopic('monde')
    await news.whenChecksIdle()
    const topic = await news.getTopic('monde')

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
    assert.deepEqual(first.sections, [{ id: 'monde', label: 'Monde', items: [], checking: 4 }])

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

    await news.getTopic('monde')
    await news.whenChecksIdle()
    const topic = await news.getTopic('monde')

    assert.deepEqual(topic?.items, [])
    // The failed article waits for its retry: it is not reported as being checked.
    assert.equal(topic?.checking, 0)

    advance(2 * 60 * 1000)
    // Both "Sommet" articles failed (Alpha's page is missing): both are checked again.
    assert.equal((await news.getTopic('monde'))?.checking, 2)
    await news.whenChecksIdle()
    assert.equal((await news.getArticle(idOf('https://beta.example/sommet'))).status, 'failed')
  })

  it('lists sources without reader as links, without fetching their articles', async () => {
    const linkOnly = parseCatalog(`
topics:
  - id: monde
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
    const topic = await news.getTopic('monde')

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

    await news.getTopic('monde')
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

    await news.getTopic('monde')
    advance(14 * 60 * 1000)
    await news.getTopic('monde')
    assert.equal(calls.filter(isFeed).length, 2)

    advance(2 * 60 * 1000)
    await news.getTopic('monde')
    assert.equal(calls.filter(isFeed).length, 4)
  })

  it('fetches the feeds again on demand, at most once a minute', async () => {
    const { news, calls, advance } = setup(feeds)

    await news.getTopic('monde')
    await news.getTopic('monde', TOPIC_PAGE_SIZE, { fresh: true })
    assert.equal(calls.filter(isFeed).length, 2)

    advance(61 * 1000)
    await news.getTopic('monde', TOPIC_PAGE_SIZE, { fresh: true })
    assert.equal(calls.filter(isFeed).length, 4)
  })

  it('keeps the last items when a refresh fails, and reports the error', async () => {
    const responses: Record<string, FakeResponse> = { ...feeds }
    const { news, advance } = setup(responses)

    await news.getTopic('monde')
    responses['https://alpha.example/feed'] = new Error('HTTP 503')
    advance(16 * 60 * 1000)

    const topic = await news.getTopic('monde')
    const alpha = topic?.sources.find(source => source.id === 'alpha')

    assert.equal(alpha?.ok, false)
    assert.equal(alpha?.error, 'HTTP 503')
    assert.equal(alpha?.itemCount, 3)
  })

  it('opens articles listed by a feed in reader mode', async () => {
    const { news } = setup({ ...feeds, 'https://beta.example/elections': articlePage('Élections') })
    await news.getTopic('monde')

    const result = await news.getArticle(idOf('https://beta.example/elections'))

    assert.equal(result.status, 'ok')
    assert.match(result.status === 'ok' ? result.article.contentHtml : '', /Paragraph 8/)
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
    await news.getTopic('monde')
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
  - id: monde
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

    assert.equal((await news.getTopic('monde'))?.label, 'Monde')
    await news.whenChecksIdle()
    assert.equal((await news.getTopic('monde', undefined, { language: 'en' }))?.label, 'World')
    assert.equal((await news.getFrontPage(undefined, undefined, 'en')).sections[0]?.label, 'World')
    const day = await news.getDay('2026-10-23', 'Europe/Brussels', null, 'en')
    assert.ok(day && day.items.length > 0 && day.items.every(item => item.topicLabel === 'World'))
    const found = await news.search('sommet', 'en')
    assert.ok(found.items.length > 0 && found.items.every(item => item.topicLabel === 'World'))
  })

  describe('summaries', () => {
    const dailySummarySetup = (summarize: (input: SummaryInput) => Promise<string[]>) => {
      const fake = fakeFetch({ ...feeds, 'https://beta.example/elections': articlePage('Élections') })
      return new NewsService(catalog, {
        fetchText: fake.fetchText,
        summarize,
        profiles: HOUSEHOLD,
        now: () => NOW,
        log: () => {}
      })
    }

    it('summarizes an article once and shares the result', async () => {
      const inputs: SummaryInput[] = []
      const news = dailySummarySetup(async input => {
        inputs.push(input)
        return ['Un point.', 'Un autre.']
      })
      await news.getTopic('monde')
      const id = idOf('https://beta.example/elections')

      const [first, second] = await Promise.all([news.getSummary(id), news.getSummary(id)])

      assert.deepEqual(first, { status: 'ok', points: ['Un point.', 'Un autre.'] })
      assert.deepEqual(second, first)
      assert.deepEqual(await news.getSummary(id), first)
      assert.equal(inputs.length, 1)
      assert.equal(inputs[0]?.title, 'Élections')
      assert.equal(inputs[0]?.sourceName, 'Beta')
      assert.equal(news.canSummarize, true)
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
        profiles: HOUSEHOLD,
        languageOf: profileId => languages[profileId] ?? 'fr',
        now: () => NOW,
        log: () => {}
      })
      await news.getTopic('monde')
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
      assert.equal(plain.canSummarize, false)
      assert.deepEqual(await plain.getSummary(idOf('https://beta.example/elections')), { status: 'unavailable' })

      let calls = 0
      const news = dailySummarySetup(async () => {
        calls++
        throw calls === 1 ? new SummaryRefusedError('no') : new Error('API down')
      })
      await news.getTopic('monde')
      const id = idOf('https://beta.example/elections')

      assert.deepEqual(await news.getSummary('AAAAAAAAAAAAAAAA'), { status: 'unknown' })
      assert.deepEqual(await news.getSummary(idOf('https://beta.example/sommet')), { status: 'failed' })
      assert.deepEqual(await news.getSummary(id), { status: 'refused' })
      // A failed summary is asked again next time.
      assert.deepEqual(await news.getSummary(id), { status: 'failed' })
      assert.equal(calls, 2)
    })

    it('shares each household cap between the profiles, the admin first for what is left over', () => {
      assert.deepEqual(
        [1, 2].map(id => profileCap(9, HOUSEHOLD(), id)),
        [5, 4]
      )
      const four = [
        { id: 3, admin: false },
        { id: 1, admin: false },
        { id: 4, admin: true },
        { id: 2, admin: false }
      ]
      assert.deepEqual(
        [4, 1, 2, 3].map(id => profileCap(10, four, id)),
        [3, 3, 2, 2]
      )
      assert.equal(profileCap(10, [{ id: 1, admin: true }], 1), 10)
    })

    it('stops calling the API after the daily caps, for the profile then for the household', async () => {
      let calls = 0
      const news = dailySummarySetup(async () => {
        calls++
        throw new Error('API down')
      })
      await news.getTopic('monde')
      const id = idOf('https://beta.example/elections')
      const household = AI_CAPS.summary
      const profile = capOf('summary')

      for (let attempt = 0; attempt < profile; attempt++) await news.getSummary(id, 1)
      assert.deepEqual(await news.getSummary(id, 1), { status: 'limited' })
      assert.equal(calls, profile)

      // Another profile still has its own calls, until the household's run out.
      for (let profileId = 2; calls < household; profileId++) {
        for (let attempt = 0; attempt < profile && calls < household; attempt++) await news.getSummary(id, profileId)
      }
      assert.deepEqual(await news.getSummary(id, 9), { status: 'limited' })
      assert.equal(calls, household)

      const usage = news.aiUsage(1).kinds.find(kind => kind.kind === 'summary')
      assert.deepEqual(usage, {
        kind: 'summary',
        used: profile,
        limit: profile,
        householdUsed: household,
        householdLimit: household
      })
      const admin = news.aiUsage(1).profiles[0]!
      assert.equal(admin.calls, profile)
      assert.deepEqual(
        admin.kinds.find(kind => kind.kind === 'summary'),
        { kind: 'summary', used: profile, limit: profile }
      )
    })

    it('puts a profile back to 0 without lowering the household, and the household back to 0 for everyone', async () => {
      const news = dailySummarySetup(async () => {
        throw new Error('API down')
      })
      await news.getTopic('monde')
      const id = idOf('https://beta.example/elections')
      const summaries = (profileId: number) => news.aiUsage(profileId).kinds.find(kind => kind.kind === 'summary')!

      for (let attempt = 0; attempt < 3; attempt++) await news.getSummary(id, 1)
      await news.getSummary(id, 2)

      news.resetAiUsage({ kind: 'summary', profileId: 1 })
      assert.equal(summaries(1).used, 0)
      assert.equal(summaries(1).householdUsed, 4)
      assert.equal(summaries(2).used, 1)

      // Its calls freed, the profile asks again up to its cap.
      for (let attempt = 0; attempt < capOf('summary'); attempt++) await news.getSummary(id, 1)
      assert.equal(summaries(1).used, capOf('summary'))

      news.resetAiUsage({})
      assert.equal(summaries(1).used, 0)
      assert.equal(summaries(2).used, 0)
      assert.equal(summaries(1).householdUsed, 0)
    })

    it('sends the article as plain text, one paragraph per block', () => {
      assert.equal(
        articleText('<h2>Titre</h2><p>Un  <b>paragraphe</b>.</p><ul><li>Point</li></ul>'),
        'Titre\n\nUn paragraphe.\n\nPoint'
      )
    })
  })

  describe('questions', () => {
    it('answers questions about an article, within a daily cap', async () => {
      const asked: string[] = []
      const fake = fakeFetch({ ...feeds, 'https://beta.example/elections': articlePage('Élections') })
      const news = new NewsService(catalog, {
        fetchText: fake.fetchText,
        profiles: HOUSEHOLD,
        answerQuestion: async ({ title, question }) => {
          asked.push(question)
          if (question === 'refus') throw new SummaryRefusedError('no')
          return { answer: `${title} : réponse.`, sources: [{ url: 'https://wiki.example/x', title: 'X' }] }
        },
        now: () => NOW,
        log: () => {}
      })
      await news.getTopic('monde')
      const id = idOf('https://beta.example/elections')

      assert.deepEqual(await news.answerQuestion(id, 'Qui ?'), {
        status: 'ok',
        answer: 'Élections : réponse.',
        sources: [{ url: 'https://wiki.example/x', title: 'X' }]
      })
      assert.deepEqual(await news.answerQuestion(id, 'refus'), { status: 'refused' })
      assert.deepEqual(await news.answerQuestion('AAAAAAAAAAAAAAAA', 'Qui ?'), { status: 'unknown' })

      for (let attempt = 2; attempt < capOf('question'); attempt++) await news.answerQuestion(id, 'Encore ?')
      assert.deepEqual(await news.answerQuestion(id, 'Une de trop ?'), { status: 'limited' })
      assert.equal(asked.length, capOf('question'))
      assert.equal((await news.answerQuestion(id, 'Et Léa ?', 2)).status, 'ok')
    })
  })

  describe('source suggestions', () => {
    it('asks for sites in a topic, within a small daily cap', async () => {
      const asked: { topic: string; replacing: string | null }[] = []
      const news = new NewsService(catalog, {
        fetchText: fakeFetch(feeds).fetchText,
        profiles: HOUSEHOLD,
        suggestSources: async ({ topic, replacing }) => {
          asked.push({ topic, replacing })
          return [{ name: 'Gamma', url: 'https://gamma.example/', reason: 'Sérieux.' }]
        },
        now: () => NOW,
        log: () => {}
      })

      assert.deepEqual(await news.suggestSources('monde', 1, { current: ['Alpha'], replacing: 'Beta' }), {
        status: 'ok',
        sites: [{ name: 'Gamma', url: 'https://gamma.example/', reason: 'Sérieux.' }]
      })
      assert.deepEqual(asked, [{ topic: 'Monde', replacing: 'Beta' }])
      assert.deepEqual(await news.suggestSources('nope', 1, { current: [], replacing: null }), { status: 'not_found' })

      for (let call = 1; call < capOf('sources'); call++)
        await news.suggestSources('monde', 1, { current: [], replacing: null })
      assert.deepEqual(await news.suggestSources('monde', 1, { current: [], replacing: null }), { status: 'limited' })
      assert.equal(asked.length, capOf('sources'))
    })

    it("asks in the profile's language, for sites in it and in the household's", async () => {
      const asked: { language: string; languages: string[] }[] = []
      const languages: Record<number, 'fr' | 'en'> = { 1: 'fr', 2: 'en' }
      const news = new NewsService(catalog, {
        fetchText: fakeFetch(feeds).fetchText,
        profiles: HOUSEHOLD,
        languageOf: profileId => languages[profileId] ?? 'fr',
        householdLanguage: () => 'fr',
        suggestSources: async ({ language, languages }) => {
          asked.push({ language, languages })
          return []
        },
        now: () => NOW,
        log: () => {}
      })

      await news.suggestSources('monde', 1, { current: [], replacing: null })
      await news.suggestSources('monde', 2, { current: [], replacing: null })
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
        profiles: HOUSEHOLD,
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
        profiles: HOUSEHOLD,
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
          { topic: 'Monde', topicId: 'monde', text: 'Version 1.' },
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
          ['monde', 'Monde', 'Sommet Européen !', 1],
          ['monde', 'Monde', 'Élections', 1]
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

    it('keeps the last daily summary when writing a new one fails, and caps the day', async () => {
      let calls = 0
      const { news, writeSettled, advance } = dailySummarySetup(async () => {
        calls++
        if (calls > 1) throw new Error('API down')
        return [{ topic: 'Monde', text: 'Le seul.' }]
      })
      await news.getTopic('monde')
      await news.whenChecksIdle()

      const first = await news.writeDailySummary()
      advance(60 * 60 * 1000)
      assert.deepEqual(await writeSettled(), first)

      for (let attempt = 0; attempt < capOf('dailySummary'); attempt++) await writeSettled()
      assert.equal(calls, capOf('dailySummary'))
      assert.deepEqual(await writeSettled(), first)
    })

    it('is unavailable without an API key', async () => {
      const news = new NewsService(catalog, { fetchText: fakeFetch(feeds).fetchText, now: () => NOW, log: () => {} })
      assert.deepEqual(news.getDailySummary(), { status: 'unavailable' })
      assert.deepEqual(await news.writeDailySummary(), { status: 'unavailable' })
    })
  })

  it('never fetches unknown ids or links outside the source domains', async () => {
    const { news, calls } = setup(feeds)
    await news.getTopic('monde')
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
    await news.getTopic('monde')

    assert.equal((await news.getArticle(idOf('https://beta.example/elections'))).status, 'unreadable')
  })

  it('reports short pages as unreadable and network errors as failed', async () => {
    const { news } = setup({
      ...feeds,
      'https://beta.example/elections': '<html><body><p>Abonnez-vous pour lire la suite.</p></body></html>',
      'https://beta.example/sommet': new Error('timeout')
    })
    await news.getTopic('monde')

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
    await news.getTopic('monde')

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
