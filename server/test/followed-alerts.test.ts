import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseAlertSettings } from '../http/push-routes.ts'
import type { FeedItem } from '../news/feed-parser.ts'
import {
  type AlertPayload,
  type AlertSettings,
  FollowedAlerts,
  MAX_ALERTS_PER_DAY,
  SUBJECT_COOLDOWN_MS,
  inQuietHours
} from '../news/followed-alerts.ts'

// Saturday 24 October 2026, 10:00 in Brussels.
const START = Date.parse('2026-10-24T08:00:00Z')
const MINUTE = 60 * 1000

const settings = (changes: Partial<AlertSettings> = {}): AlertSettings => ({
  target: { endpoint: 'https://web.push.apple.com/abc', keys: { p256dh: 'key', auth: 'auth' } },
  words: ['GTA 6'],
  mutedWords: [],
  hiddenSources: [],
  quietStart: '22:00',
  quietEnd: '07:00',
  timeZone: 'Europe/Brussels',
  badge: true,
  ...changes
})

let nextId = 0
const article = (title: string, publishedAt: number, sourceId = 'jdg', summary = ''): FeedItem => ({
  id: `item-${nextId++}`,
  sourceId,
  sourceName: 'Journal du Geek',
  kind: 'article',
  lang: 'fr',
  title,
  summary,
  link: 'https://example.com/a',
  publishedAt: new Date(publishedAt).toISOString(),
  image: null,
  media: null
})

const setup = () => {
  let clock = START
  const items: FeedItem[] = []
  const sent: AlertPayload[] = []
  let failWith: number | null = null
  const alerts = new FollowedAlerts({
    listItems: async () => items,
    send: async (_target, payload) => {
      if (failWith) throw Object.assign(new Error('gone'), { statusCode: failWith })
      sent.push(payload)
    },
    now: () => clock,
    log: () => {}
  })
  return {
    alerts,
    items,
    sent,
    advance: (ms: number) => (clock += ms),
    now: () => clock,
    fail: (status: number) => (failWith = status)
  }
}

describe('followed alerts', () => {
  it('announces only articles published since the subject was followed, once each', async () => {
    const { alerts, items, sent, advance, now } = setup()
    items.push(article('GTA 6 : la bande-annonce', START - 60 * MINUTE))
    alerts.register(settings())

    await alerts.check()
    assert.deepEqual(sent, [])

    advance(10 * MINUTE)
    const fresh = article(
      'GTA 6 : la date de sortie',
      now(),
      'jdg',
      `Rockstar a enfin donné la date. ${'Bla '.repeat(60)}`
    )
    items.push(fresh, article('Les bons plans du 24/10/2026', now()))
    await alerts.check()
    await alerts.check()

    assert.deepEqual(sent, [
      {
        title: 'GTA 6 : la date de sortie',
        body: `Rockstar a enfin donné la date. ${'Bla '.repeat(30)}Bla…`,
        url: `#/article/${fresh.id}`,
        tag: 'followed:GTA 6',
        badge: 1
      }
    ])
  })

  it('groups articles within the cooldown, keeps quiet hours, and counts for the badge', async () => {
    const { alerts, items, sent, advance, now } = setup()
    alerts.register(settings({ words: ['GTA 6', 'Iran'] }))

    advance(MINUTE)
    items.push(article('GTA 6 : premier', now()))
    await alerts.check()
    advance(30 * MINUTE)
    items.push(
      article('GTA VI : deuxième', now() - MINUTE),
      article('GTA 6 : troisième', now()),
      article('Iran : sommet', now()),
      article('GTA 6 : muet', now(), 'muted')
    )
    alerts.register(settings({ words: ['GTA 6', 'Iran'], hiddenSources: ['muted'] }))
    await alerts.check()

    assert.deepEqual(
      sent.map(payload => [payload.title, payload.body, payload.badge]),
      [
        ['GTA 6 : premier', 'Journal du Geek', 1],
        ['Iran : sommet', 'Journal du Geek', 4]
      ]
    )

    // After the cooldown the waiting one goes, unless it is night in Brussels.
    advance(SUBJECT_COOLDOWN_MS)
    alerts.register(
      settings({ words: ['GTA 6', 'Iran'], hiddenSources: ['muted'], quietStart: '12:00', quietEnd: '14:00' })
    )
    await alerts.check()
    assert.equal(sent.length, 2)

    alerts.markSeen(settings().target.endpoint)
    alerts.register(settings({ words: ['GTA 6', 'Iran'], hiddenSources: ['muted'] }))
    await alerts.check()
    assert.deepEqual(sent.at(-1), {
      title: 'GTA 6 : troisième',
      body: 'Journal du Geek',
      url: '#/followed',
      tag: 'followed:GTA 6',
      badge: 0
    })
  })

  it('caps the day and forgets devices whose subscription is gone', async () => {
    const { alerts, items, sent, advance, now, fail } = setup()
    const words = Array.from({ length: MAX_ALERTS_PER_DAY + 3 }, (_, index) => `Sujet${index}`)
    alerts.register(settings({ words, quietStart: '00:00', quietEnd: '00:00' }))
    advance(MINUTE)
    for (const word of words) items.push(article(`${word} en vue`, now()))

    await alerts.check()
    assert.equal(sent.length, MAX_ALERTS_PER_DAY)

    advance(25 * 60 * MINUTE)
    fail(410)
    await alerts.check()
    assert.equal(alerts.size, 0)
  })

  it('knows quiet hours across midnight, in the device time zone', () => {
    const at = (iso: string) => Date.parse(iso)
    assert.equal(inQuietHours(settings(), at('2026-10-24T21:30:00Z')), true) // 23:30 in Brussels
    assert.equal(inQuietHours(settings(), at('2026-10-24T04:30:00Z')), true) // 06:30
    assert.equal(inQuietHours(settings(), at('2026-10-24T05:30:00Z')), false) // 07:30
    assert.equal(inQuietHours(settings({ quietStart: '07:00', quietEnd: '07:00' }), at('2026-10-24T21:30:00Z')), false)
  })
})

describe('parseAlertSettings', () => {
  const body = {
    target: { endpoint: 'https://web.push.apple.com/abc', keys: { p256dh: 'key', auth: 'auth' } },
    words: ['GTA 6'],
    mutedWords: [],
    hiddenSources: [],
    quietStart: '22:00',
    quietEnd: '07:00',
    timeZone: 'Europe/Brussels',
    badge: true
  }

  it('accepts a known push service and well-formed settings', () => {
    assert.deepEqual(parseAlertSettings(body), { ...body, shares: true, reactions: true, plugins: true })
  })

  it('refuses other endpoints and odd values', () => {
    for (const changes of [
      { target: { ...body.target, endpoint: 'https://evil.example/push' } },
      { target: { ...body.target, endpoint: 'http://web.push.apple.com/abc' } },
      { quietStart: '25:00' },
      { timeZone: 'Nowhere/City' },
      { words: 'GTA 6' },
      { badge: 'yes' }
    ]) {
      assert.equal(parseAlertSettings({ ...body, ...changes }), null, JSON.stringify(changes))
    }
  })
})

describe('FollowedAlerts subscriptions', () => {
  it('keeps devices across a restart and forgets those unregistered', async () => {
    const { openDatabase } = await import('../db/database.ts')
    const { UserStore } = await import('../db/user-store.ts')
    const users = new UserStore(openDatabase(':memory:'))
    const subscriptions = {
      list: () => users.listPushSubscriptions(),
      save: (value: AlertSettings) => users.savePushSubscription(value, START),
      remove: (endpoint: string) => users.removePushSubscription(endpoint)
    }
    const options = { listItems: async () => [], send: async () => {}, subscriptions, now: () => START }

    new FollowedAlerts(options).register(settings())
    const restarted = new FollowedAlerts(options)
    assert.equal(restarted.size, 1)

    restarted.unregister(settings().target.endpoint)
    assert.equal(new FollowedAlerts(options).size, 0)
  })

  it('tells a profile’s devices of a share at once, unless turned off or in quiet hours', async () => {
    const { alerts, sent, advance } = setup()
    const share = { title: 'Léa t’envoie un article', body: 'Titre', url: '#/article/a', tag: 'share:a', badge: null }
    alerts.register(settings({ profileId: 2 }))
    alerts.register(
      settings({
        profileId: 2,
        shares: false,
        target: { ...settings().target, endpoint: 'https://web.push.apple.com/off' }
      })
    )
    alerts.register(
      settings({ profileId: 3, target: { ...settings().target, endpoint: 'https://web.push.apple.com/other' } })
    )

    await alerts.notifyShare(2, share)
    assert.deepEqual(sent, [share])

    // 23:00 in Brussels.
    advance(13 * 60 * MINUTE)
    await alerts.notifyShare(2, share)
    assert.equal(sent.length, 1)
  })

  it('tells a profile of reactions to what it sent, unless turned off', async () => {
    const { alerts, sent } = setup()
    const reaction = { title: 'Léa a réagi ❤️', body: 'Titre', url: '#/article/a', tag: 'reaction:a:2', badge: null }
    alerts.register(settings({ profileId: 1, shares: false }))
    alerts.register(
      settings({
        profileId: 1,
        reactions: false,
        target: { ...settings().target, endpoint: 'https://web.push.apple.com/off' }
      })
    )

    await alerts.notifyShare(1, reaction, 'reactions')
    assert.deepEqual(sent, [reaction])
  })

  it('takes devices registered before shares could be turned off as on', () => {
    const { shares, ...older } = settings()
    assert.equal(shares, undefined)
    assert.equal(parseAlertSettings(older)?.shares, true)
    assert.equal(parseAlertSettings({ ...older, shares: false })?.shares, false)
    assert.equal(parseAlertSettings({ ...older, shares: 'no' }), null)
    assert.equal(parseAlertSettings(older)?.reactions, true)
    assert.equal(parseAlertSettings({ ...older, reactions: false })?.reactions, false)
    assert.equal(parseAlertSettings(older)?.plugins, true)
    assert.equal(parseAlertSettings({ ...older, plugins: false })?.plugins, false)
    assert.equal(parseAlertSettings({ ...older, plugins: 'no' }), null)
  })

  it('tells a profile what a plugin sends, unless its « Plugins » switch is off', async () => {
    const { alerts, sent } = setup()
    const notice = {
      title: 'Village · Bonjour',
      body: 'Un mot.',
      url: '#/settings/plugin/village',
      tag: 'plugin:village',
      badge: null
    }
    alerts.register(settings({ profileId: 1 }))
    alerts.register(
      settings({
        profileId: 1,
        plugins: false,
        target: { ...settings().target, endpoint: 'https://web.push.apple.com/off' }
      })
    )

    await alerts.notifyShare(1, notice, 'plugins')
    assert.deepEqual(sent, [notice])
  })
})

describe('followed alerts in two households', () => {
  it("tells each device about its own household's sources only", async () => {
    let clock = START
    // Profile 1 reads in the Duponts' household, profile 10 in the Martins'.
    const byHousehold: Record<number, FeedItem[]> = { 1: [], 2: [] }
    const listed: number[] = []
    const sent: [string, string][] = []
    const alerts = new FollowedAlerts({
      listItems: async householdId => {
        listed.push(householdId)
        return byHousehold[householdId] ?? []
      },
      householdOf: profileId => (profileId === 10 ? 2 : 1),
      send: async (target, payload) => {
        sent.push([target.endpoint, payload.title])
      },
      now: () => clock,
      log: () => {}
    })
    alerts.register(settings({ profileId: 1 }))
    alerts.register(
      settings({ profileId: 10, target: { ...settings().target, endpoint: 'https://web.push.apple.com/martin' } })
    )

    clock += MINUTE
    byHousehold[1]!.push(article('GTA 6 : chez les Dupont', clock))
    byHousehold[2]!.push(article('GTA 6 : chez les Martin', clock, 'other'))
    await alerts.check()

    assert.deepEqual(listed.toSorted(), [1, 2])
    assert.deepEqual(sent.toSorted(), [
      ['https://web.push.apple.com/abc', 'GTA 6 : chez les Dupont'],
      ['https://web.push.apple.com/martin', 'GTA 6 : chez les Martin']
    ])
  })
})
