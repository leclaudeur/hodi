import { describe, expect, it } from 'vitest'
import {
  SERVER_HREF,
  SETTINGS_SECTIONS,
  articleHref,
  englishHash,
  parseRoute,
  pluginPageHref,
  requestHref,
  searchHref,
  serverHref,
  serverPluginHref,
  serverPluginPageHref,
  settingsHref,
  storyHref,
  topicHref,
  watchHref,
  youngProfileHref
} from '../src/lib/use-hash-route.ts'
import { parsePreferences } from '../src/lib/preferences.ts'

describe('hash routes', () => {
  it('opens the front page from an empty address', () => {
    expect(parseRoute('')).toEqual({ name: 'frontPage' })
    expect(parseRoute('#/')).toEqual({ name: 'frontPage' })
  })

  it('reads back every address the app links to', () => {
    expect(parseRoute(articleHref('ab_CD-12'))).toEqual({ name: 'article', articleId: 'ab_CD-12' })
    expect(parseRoute(topicHref('belgium'))).toEqual({ name: 'topic', topicId: 'belgium' })
    expect(parseRoute(watchHref('v1'))).toEqual({ name: 'listen', itemId: 'v1' })
    expect(parseRoute(storyHref('world'))).toEqual({ name: 'story', topicId: 'world' })
    expect(parseRoute(requestHref(12))).toEqual({ name: 'settings', section: null, request: 12 })
    expect(parseRoute(youngProfileHref(3))).toEqual({ name: 'settings', section: 'profiles', item: '3' })
    expect(parseRoute(pluginPageHref('diagnostic'))).toEqual({
      name: 'settings',
      section: 'plugin',
      item: 'diagnostic'
    })
  })

  it("reads the server's space, its sections and a plugin's page in it", () => {
    expect(parseRoute(SERVER_HREF)).toEqual({ name: 'server', section: null })
    expect(parseRoute(serverHref('overview'))).toEqual({ name: 'server', section: 'overview' })
    expect(parseRoute(serverHref('plugins'))).toEqual({ name: 'server', section: 'plugins' })
    expect(parseRoute(serverPluginHref('my plugin'))).toEqual({ name: 'server', section: 'plugins', item: 'my plugin' })
    // An unknown section opens the space, as an unknown settings section opens Réglages.
    expect(parseRoute('#/server/nowhere')).toEqual({ name: 'server', section: null })
  })

  it("reads a plugin's own sections of the server's space and its screens under them", () => {
    expect(serverPluginPageHref('village', 'waitlist')).toBe('#/server/plugin/village/waitlist')
    expect(serverPluginPageHref('village', 'waitlist', 'été/2')).toBe(
      '#/server/plugin/village/waitlist/%C3%A9t%C3%A9/2'
    )
    expect(parseRoute(serverPluginPageHref('village', 'waitlist', 'été/2'))).toEqual({
      name: 'server',
      section: null,
      plugin: { id: 'village', section: 'waitlist', path: 'été/2' }
    })
    expect(parseRoute(serverPluginPageHref('village', 'signups'))).toEqual({
      name: 'server',
      section: null,
      plugin: { id: 'village', section: 'signups', path: '' }
    })
    // Without a section, the space opens.
    expect(parseRoute('#/server/plugin/village')).toEqual({ name: 'server', section: null, item: 'village' })
  })

  it("reads a plugin's own screens under its page", () => {
    expect(pluginPageHref('diagnostic', 'week/3')).toBe('#/settings/plugin/diagnostic/week/3')
    expect(pluginPageHref('diagnostic', 'été')).toBe('#/settings/plugin/diagnostic/%C3%A9t%C3%A9')
    expect(parseRoute(pluginPageHref('diagnostic', 'week/3'))).toEqual({
      name: 'settings',
      section: 'plugin',
      item: 'diagnostic',
      path: 'week/3'
    })
    expect(parseRoute(pluginPageHref('diagnostic', 'été'))).toMatchObject({ path: 'été' })
  })

  it('keeps a search query with spaces and slashes', () => {
    expect(parseRoute(searchHref('pluie à Liège'))).toEqual({ name: 'search', query: 'pluie à Liège' })
    expect(parseRoute(searchHref('a/b'))).toEqual({ name: 'search', query: 'a/b' })
  })

  it('opens each Réglages section from its English name', () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(parseRoute(settingsHref(section))).toEqual({ name: 'settings', section })
    }
    expect(parseRoute('#/settings/unknown')).toEqual({ name: 'settings', section: null })
  })

  it('links to English addresses only', () => {
    expect(searchHref('liège')).toBe('#/search/li%C3%A8ge')
    expect(settingsHref('household')).toBe('#/settings/household')
    expect(settingsHref('themes')).toBe('#/settings/topics')
    expect(requestHref(4)).toBe('#/settings/requests/4')
    expect(storyHref('monde')).toBe('#/stories/monde')
  })

  it('turns the French addresses of earlier versions into English ones', () => {
    expect(englishHash('#/plus-tard')).toBe('#/saved')
    expect(englishHash('#/recherche/pluie%20%C3%A0%20Li%C3%A8ge')).toBe('#/search/pluie%20%C3%A0%20Li%C3%A8ge')
    expect(englishHash('#/reglages')).toBe('#/settings')
    expect(englishHash('#/reglages/foyer')).toBe('#/settings/household')
    expect(englishHash('#/reglages/a-propos')).toBe('#/settings/about')
    expect(englishHash('#/reglages/profils/3')).toBe('#/settings/profiles/3')
    expect(englishHash('#/reglages/demandes/12')).toBe('#/settings/requests/12')
    expect(englishHash('#/suivis')).toBe('#/followed')
    expect(englishHash('#/partages')).toBe('#/shares')
    expect(englishHash('#/resume')).toBe('#/summary')
    expect(englishHash('#/historique')).toBe('#/history')
    expect(englishHash('#/profils')).toBe('#/profiles')
    expect(englishHash('#/une/monde')).toBe('#/stories/world')
    expect(englishHash('#/ecouter')).toBe('#/videos')
    // English topics, articles and English addresses stay as they are.
    expect(englishHash('#/belgium')).toBe('#/belgium')
    expect(englishHash('#/article/ab')).toBe('#/article/ab')
    expect(englishHash('#/constructor')).toBe('#/constructor')
    expect(englishHash('')).toBe('')
  })

  it('still opens the old addresses', () => {
    expect(parseRoute('#/reglages/foyer')).toEqual({ name: 'settings', section: 'household' })
    expect(parseRoute('#/reglages/demandes/12')).toEqual({ name: 'settings', section: null, request: 12 })
    expect(parseRoute('#/recherche/pluie')).toEqual({ name: 'search', query: 'pluie' })
    expect(parseRoute('#/plus-tard')).toEqual({ name: 'saved' })
    expect(parseRoute('#/ecouter')).toEqual({ name: 'listen', itemId: null })
    expect(parseRoute('#/sources')).toEqual({ name: 'settings', section: 'sources' })
    expect(parseRoute('#/stats')).toEqual({ name: 'settings', section: 'stats' })
  })

  it("opens Réglages, or a plugin's own page, from the addresses of Réglages › Plugins", () => {
    expect(parseRoute('#/settings/plugins')).toEqual({ name: 'settings', section: null })
    expect(parseRoute('#/settings/plugins/diagnostic')).toEqual({
      name: 'settings',
      section: 'plugin',
      item: 'diagnostic'
    })
  })
})

describe('topics renamed in English', () => {
  it('turns an old topic address into its English one', () => {
    expect(englishHash('#/belgique')).toBe('#/belgium')
    expect(englishHash('#/une/monde')).toBe('#/stories/world')
    expect(englishHash('#/stories/monde')).toBe('#/stories/world')
    expect(englishHash('#/tech')).toBe('#/tech')
    expect(englishHash('#/stories/tech')).toBe('#/stories/tech')
  })

  it('opens a topic from its old French address', () => {
    expect(parseRoute('#/belgique')).toEqual({ name: 'topic', topicId: 'belgium' })
    expect(parseRoute('#/films-series')).toEqual({ name: 'topic', topicId: 'film-tv' })
    expect(parseRoute('#/une/monde')).toEqual({ name: 'story', topicId: 'world' })
    expect(parseRoute('#/tech')).toEqual({ name: 'topic', topicId: 'tech' })
  })

  it('reads preferences a device kept with the old ids', () => {
    const preferences = parsePreferences({
      topicOrder: ['monde', 'tech', 'belgique'],
      hiddenTopics: ['sante'],
      accent: 'jeux-video'
    })
    expect(preferences.topicOrder).toEqual(['world', 'tech', 'belgium'])
    expect(preferences.hiddenTopics).toEqual(['health'])
    // Corail (gaming) is no longer an accent: the nearest one kept, Rose.
    expect(preferences.accent).toBe('film-tv')
    expect(parsePreferences({ accent: 'corail' }).accent).toBe('film-tv')
    expect(parsePreferences({ accent: 'ocre' }).accent).toBe('belgium')
    expect(parsePreferences({ accent: 'music' }).accent).toBe('film-tv')
  })
})
