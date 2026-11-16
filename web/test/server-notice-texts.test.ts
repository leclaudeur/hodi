import { describe, expect, it } from 'vitest'
import type { ServerNoticeKind } from '../src/api.ts'
import { noticeGroups, noticeTexts } from '../src/lib/server-notice-texts.ts'

const village = { id: 'village', name: 'Village', translations: { en: { name: 'Village (EN)' } } }
const kind = (key: string, plugin: ServerNoticeKind['plugin'] = village): ServerNoticeKind => ({
  id: `plugin:${plugin?.id}:${key}`,
  key,
  plugin,
  label: `Libellé ${key}`,
  hint: null,
  translations: { en: { label: `Label ${key}` } },
  email: true,
  push: false
})

describe('the rows of Serveur › Notifications', () => {
  it('names a plugin’s kind from its locales, else from its manifest', () => {
    expect(noticeTexts(kind('household'), 'en-GB')).toEqual({ label: 'Label household', hint: null })
    expect(noticeTexts(kind('household'), 'fr')).toEqual({ label: 'Libellé household', hint: null })
  })

  it('names the core’s own kinds from the app’s texts, under « Serveur »', () => {
    const report = { ...kind('weekly-report', null), id: 'core:weekly-report', label: null, translations: {} }
    expect(noticeTexts(report, 'fr').label).toBe('Rapport de la semaine')
    expect(noticeGroups([report], 'fr').map(group => group.name)).toEqual(['Serveur'])
  })

  it('groups the kinds under each plugin’s name, in the server’s order', () => {
    const other = { id: 'club', name: 'Club', translations: {} }
    const groups = noticeGroups([kind('household'), kind('match', other), kind('waitlist')], 'en')
    expect(groups.map(group => [group.name, group.kinds.map(entry => entry.key)])).toEqual([
      ['Village (EN)', ['household', 'waitlist']],
      ['Club', ['match']]
    ])
  })
})
