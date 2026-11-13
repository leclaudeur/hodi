import { describe, expect, it, vi } from 'vitest'
import {
  hasCapability,
  localesToLoad,
  pluginFile,
  type PluginInfo,
  slotsOf,
  type WebPlugin
} from '../src/plugins/registry.ts'
import {
  menuPlugins,
  overviewPluginCards,
  placePlugins,
  serverPluginGroups,
  setupPluginSteps
} from '../src/plugins/menu.ts'
import { restartPercent, waitForRestart } from '../src/plugins/restart.ts'

const plugin = (change: Partial<PluginInfo> = {}): PluginInfo => ({
  id: 'hello',
  name: 'Bonjour',
  version: '1.0.0',
  description: null,
  translations: {},
  audience: 'all',
  provides: [],
  menu: null,
  settings: [],
  values: {},
  enabled: true,
  signed: true,
  web: { script: true, style: false, publicScript: false, publicStyle: false, locales: ['en', 'fr'] },
  error: null,
  ...change
})

describe('plugin files', () => {
  it('carries the version, so an update is fetched at once', () => {
    expect(pluginFile(plugin(), 'web.js')).toBe('/api/plugins/hello/files/web.js?v=1.0.0')
    expect(pluginFile(plugin({ version: '2.0.0-beta.1' }), 'locales/fr.json')).toBe(
      '/api/plugins/hello/files/locales/fr.json?v=2.0.0-beta.1'
    )
  })

  it('comes from the public address for a plugin loaded before sign-in', () => {
    expect(pluginFile(plugin({ public: true }), 'web.js')).toBe('/api/public/plugins/hello/files/web.js?v=1.0.0')
  })

  it('loads the language shown and French, the fallback, when the plugin has them', () => {
    expect(localesToLoad(['en', 'fr'], 'en')).toEqual(['en', 'fr'])
    expect(localesToLoad(['en', 'fr'], 'fr')).toEqual(['fr'])
    expect(localesToLoad(['fr'], 'en')).toEqual(['fr'])
    expect(localesToLoad(['en'], 'fr')).toEqual([])
  })
})

describe('plugin capabilities', () => {
  it('counts only active plugins that load', () => {
    const child = { provides: ['profile-kind:child'] }
    expect(hasCapability([plugin(child)], 'profile-kind:child')).toBe(true)
    expect(hasCapability([plugin({ ...child, enabled: false })], 'profile-kind:child')).toBe(false)
    expect(hasCapability([plugin({ ...child, error: 'broken' })], 'profile-kind:child')).toBe(false)
    expect(hasCapability([plugin(child)], 'speech')).toBe(false)
  })
})

describe('waiting for a restart', () => {
  const health = (answers: (string | null)[]) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const boot = answers.shift() ?? null
        if (boot === null) throw new TypeError('Failed to fetch')
        return new Response(JSON.stringify({ status: 'ok', boot }))
      })
    )

  it('resolves once Hodi answers from a new start', async () => {
    // Still the old start, then down, then the new one.
    health(['aaaa', null, null, 'bbbb'])
    const onStopped = vi.fn()
    expect(await waitForRestart('aaaa', { interval: 1, onStopped })).toBe(true)
    // Said once, when the old start first stops answering.
    expect(onStopped).toHaveBeenCalledTimes(1)
  })

  it('gives up when no new start answers in time', async () => {
    health(['aaaa', 'aaaa', 'aaaa', 'aaaa'])
    let clock = 0
    expect(await waitForRestart('aaaa', { interval: 1, timeout: 3, now: () => clock++ })).toBe(false)
  })
})

describe('the restart percentage', () => {
  it('moves through each step without passing its end', () => {
    expect(restartPercent('sent', 0)).toBe(0)
    expect(restartPercent('sent', 2000)).toBeGreaterThan(10)
    expect(restartPercent('sent', 600_000)).toBeLessThan(45)
    expect(restartPercent('stopped', 0)).toBe(45)
    expect(restartPercent('stopped', 600_000)).toBeLessThan(90)
    expect(restartPercent('back', 0)).toBe(100)
  })
})

describe('plugin pages in Réglages', () => {
  const page = () => null
  const web = new Map([
    ['diagnostic', { page }],
    ['other', { page }],
    ['silent', {}]
  ])
  const groups = [
    { id: 'reading', entries: [{ id: 'reading' }, { id: 'themes' }] },
    { id: 'household', entries: [{ id: 'household' }, { id: 'ai' }, { id: 'plugins' }] }
  ]
  const ids = (placed: typeof groups) => placed.map(group => group.entries.map(entry => entry.id))

  it('lists only the plugins on, loaded, with a menu and a page', () => {
    const menu = { group: 'household', after: 'ai' }
    expect(
      menuPlugins(
        [
          plugin({ id: 'diagnostic', menu }),
          plugin({ id: 'other', menu, enabled: false }),
          plugin({ id: 'silent', menu }),
          plugin({ id: 'nomenu' })
        ],
        web
      )
    ).toEqual([{ id: 'diagnostic', group: 'household', after: 'ai' }])
  })

  it('places a page after the entry its manifest names, in order', () => {
    const placed = placePlugins(
      groups,
      [
        { id: 'diagnostic', group: 'household', after: 'ai' },
        { id: 'other', group: 'household', after: 'ai' }
      ],
      plugin => ({ id: `plugin:${plugin.id}` })
    )
    expect(ids(placed)).toEqual([
      ['reading', 'themes'],
      ['household', 'ai', 'plugin:diagnostic', 'plugin:other', 'plugins']
    ])
  })

  it('puts a page with an unknown group or entry at the end of the household', () => {
    const placed = placePlugins(
      groups,
      [
        { id: 'a', group: 'nowhere' },
        { id: 'b', group: 'reading', after: 'missing' }
      ],
      plugin => ({ id: plugin.id })
    )
    expect(ids(placed)).toEqual([
      ['reading', 'themes', 'b'],
      ['household', 'ai', 'plugins', 'a']
    ])
  })
})

describe('plugin sections of the server', () => {
  const page = () => null
  it('gives each active plugin with sections a group, keeping only valid sections once', () => {
    const plugins = [
      plugin({ id: 'village', name: 'Village' }),
      plugin({ id: 'off', enabled: false }),
      plugin({ id: 'broken', error: 'boom' }),
      plugin({ id: 'none' })
    ]
    const web = new Map([
      [
        'village',
        {
          serverSections: [
            { id: 'signups', label: 'signups', page },
            { id: 'signups', label: 'again', page },
            { id: 'Bad Id', label: 'bad', page },
            { id: 'waitlist', label: 'waitlist', page }
          ]
        }
      ],
      ['off', { serverSections: [{ id: 'a', label: 'a', page }] }],
      ['broken', { serverSections: [{ id: 'a', label: 'a', page }] }],
      ['none', {}]
    ])
    const groups = serverPluginGroups(plugins, web)
    expect(groups.map(group => group.plugin.id)).toEqual(['village'])
    expect(groups[0]!.sections.map(section => section.label)).toEqual(['signups', 'waitlist'])
  })
})

describe('plugin cards on the overview', () => {
  const component = () => null

  it('lists the valid cards of active plugins, once each, in their order', () => {
    const plugins = [plugin({ id: 'village' }), plugin({ id: 'off', enabled: false }), plugin({ id: 'hello' })]
    const web = new Map<string, WebPlugin>([
      [
        'village',
        {
          overviewCards: [
            { id: 'households', size: 'full', component },
            { id: 'households', size: 'wide', component },
            { id: 'Bad Id', size: 'narrow', component },
            { id: 'huge', size: 'huge' as never, component },
            { id: 'accounts', size: 'narrow', component }
          ]
        }
      ],
      ['off', { overviewCards: [{ id: 'a', size: 'narrow', component }] }],
      ['hello', { overviewCards: [{ id: 'said', size: 'narrow', component }] }]
    ])
    expect(overviewPluginCards(plugins, web).map(({ plugin, card }) => `${plugin.id}/${card.id}/${card.size}`)).toEqual(
      ['village/households/full', 'village/accounts/narrow', 'hello/said/narrow']
    )
  })
})

describe('plugin steps in the setup', () => {
  const page = () => null
  const step = (id: string) => ({ id, title: 'step.title', intro: 'step.intro', page })

  it('lists the steps of enabled, signed plugins in their order, with the core e-mail step', () => {
    const web = new Map<string, WebPlugin>([
      ['hello', { setupSteps: [step('welcome'), { id: 'mail', core: 'mail' }] }],
      ['other', { setupSteps: [step('rules')] }]
    ])
    const steps = setupPluginSteps([plugin(), plugin({ id: 'other' })], web)
    expect(steps.map(({ plugin, step }) => `${plugin.id}/${step.id}`)).toEqual([
      'hello/welcome',
      'hello/mail',
      'other/rules'
    ])
  })

  it('leaves out plugins off, unsigned or broken, and steps that are malformed or repeated', () => {
    const web = new Map<string, WebPlugin>([
      ['hello', { setupSteps: [step('welcome'), step('welcome'), step('Bad id'), { id: 'x', core: 'sms' } as never] }],
      ['off', { setupSteps: [step('a')] }],
      ['unsigned', { setupSteps: [step('a')] }],
      ['broken', { setupSteps: [step('a')] }],
      ['nopage', { setupSteps: [{ id: 'a', title: 't', intro: 'i', page: 'nope' } as never] }]
    ])
    const steps = setupPluginSteps(
      [
        plugin(),
        plugin({ id: 'off', enabled: false }),
        plugin({ id: 'unsigned', signed: false }),
        plugin({ id: 'broken', error: 'failed' }),
        plugin({ id: 'nopage' })
      ],
      web
    )
    expect(steps.map(({ plugin, step }) => `${plugin.id}/${step.id}`)).toEqual(['hello/welcome'])
  })
})

describe('plugin places around sign-in', () => {
  const Page = () => null
  const Footer = () => null

  it('come in the order of the plugins, without the ones that are off, broken or give nothing', () => {
    const plugins = [
      plugin({ id: 'first' }),
      plugin({ id: 'off', enabled: false }),
      plugin({ id: 'broken', error: 'failed' }),
      plugin({ id: 'quiet' }),
      plugin({ id: 'second' })
    ]
    const web = new Map<string, WebPlugin>([
      ['second', { signedOutPage: Page, whoIsReadingFooter: Footer }],
      ['off', { signedOutPage: Page }],
      ['broken', { whoIsReadingFooter: Footer }],
      ['quiet', {}],
      ['first', { whoIsReadingFooter: Footer, ageConsent: 'consent' }]
    ])
    expect(slotsOf({ plugins, web }, 'whoIsReadingFooter').map(slot => slot.id)).toEqual(['first', 'second'])
    expect(slotsOf({ plugins, web }, 'signedOutPage')).toEqual([{ id: 'second', value: Page }])
    expect(slotsOf({ plugins, web }, 'ageConsent')).toEqual([{ id: 'first', value: 'consent' }])
    expect(slotsOf({ plugins, web }, 'avatarMenu')).toEqual([])
  })
})
