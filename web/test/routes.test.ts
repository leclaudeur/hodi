import { describe, expect, it } from 'vitest'
import {
  SETTINGS_SECTIONS,
  articleHref,
  parseRoute,
  requestHref,
  searchHref,
  settingsHref,
  storyHref,
  topicHref,
  watchHref,
  youngProfileHref
} from '../src/lib/use-hash-route.ts'

describe('hash routes', () => {
  it('opens the front page from an empty address', () => {
    expect(parseRoute('')).toEqual({ name: 'frontPage' })
    expect(parseRoute('#/')).toEqual({ name: 'frontPage' })
  })

  it('reads back every address the app links to', () => {
    expect(parseRoute(articleHref('ab_CD-12'))).toEqual({ name: 'article', articleId: 'ab_CD-12' })
    expect(parseRoute(topicHref('belgique'))).toEqual({ name: 'topic', topicId: 'belgique' })
    expect(parseRoute(watchHref('v1'))).toEqual({ name: 'listen', itemId: 'v1' })
    expect(parseRoute(storyHref('monde'))).toEqual({ name: 'story', topicId: 'monde' })
    expect(parseRoute(requestHref(12))).toEqual({ name: 'settings', section: null, request: 12 })
    expect(parseRoute(youngProfileHref(3))).toEqual({ name: 'settings', section: 'profiles', item: '3' })
  })

  it('keeps a search query with spaces and slashes', () => {
    expect(parseRoute(searchHref('pluie à Liège'))).toEqual({ name: 'search', query: 'pluie à Liège' })
    expect(parseRoute(searchHref('a/b'))).toEqual({ name: 'search', query: 'a/b' })
  })

  it('opens each Réglages section from its French name', () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(parseRoute(settingsHref(section))).toEqual({ name: 'settings', section })
    }
    expect(parseRoute('#/reglages/inconnu')).toEqual({ name: 'settings', section: null })
  })

  it('still opens the old addresses', () => {
    expect(parseRoute('#/ecouter')).toEqual({ name: 'listen', itemId: null })
    expect(parseRoute('#/sources')).toEqual({ name: 'settings', section: 'sources' })
    expect(parseRoute('#/stats')).toEqual({ name: 'settings', section: 'stats' })
  })
})
