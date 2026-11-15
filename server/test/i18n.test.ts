import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import i18next from 'i18next'
import { LANGUAGES, isLanguage } from '../../shared/i18n.ts'
import { I18N_OPTIONS, RESOURCES } from '../../shared/locales.ts'
import { textsIn } from '../i18n.ts'

// Every key of a locale file, "setup.start.title", plural forms under their base key.
const keys = (node: object, prefix = ''): string[] =>
  Object.entries(node).flatMap(([key, value]) =>
    typeof value === 'object' && value !== null
      ? keys(value as object, `${prefix}${key}.`)
      : [`${prefix}${key.replace(/_(zero|one|two|few|many|other)$/, '')}`]
  )

describe('interface languages', () => {
  it('has every French text in every language, and nothing more', () => {
    const french = new Set(keys(RESOURCES.fr.translation))
    for (const language of LANGUAGES) {
      assert.deepEqual(new Set(keys(RESOURCES[language].translation)), french, `${language}.json`)
    }
  })

  it('leaves no text empty', () => {
    for (const language of LANGUAGES) {
      const empty = Object.entries(RESOURCES[language].translation).length === 0
      assert.equal(empty, false)
      const walk = (node: object, path: string): void => {
        for (const [key, value] of Object.entries(node)) {
          if (typeof value === 'string') assert.notEqual(value.trim(), '', `${language}: ${path}${key}`)
          else walk(value as object, `${path}${key}.`)
        }
      }
      walk(RESOURCES[language].translation, '')
    }
  })

  it('fills in values and picks the plural form', async () => {
    const i18n = i18next.createInstance()
    await i18n.init({ ...I18N_OPTIONS, lng: 'fr' })
    assert.equal(i18n.t('password.missing', { count: 1 }), 'Encore 1 caractère.')
    assert.equal(i18n.t('password.missing', { count: 3 }), 'Encore 3 caractères.')
    const en = i18n.getFixedT('en')
    assert.equal(en('password.missing', { count: 3 }), '3 more characters.')
    assert.equal(en('setup.step', { step: 2, total: 4 }), 'Step 2 of 4')
  })

  it('knows its languages', () => {
    assert.equal(isLanguage('en'), true)
    assert.equal(isLanguage('nl'), false)
    assert.equal(isLanguage(null), false)
  })
})

describe('textsIn', () => {
  it('writes the notifications in the language of the profile they go to', () => {
    assert.equal(textsIn('fr')('push.shared.video', { name: 'Léa' }), 'Léa t’envoie une vidéo')
    assert.equal(textsIn('en')('push.shared.video', { name: 'Léa' }), 'Léa sent you a video')
    assert.equal(textsIn('en')('push.reacted', { name: 'Léa', reaction: '❤️' }), 'Léa reacted ❤️')
    assert.equal(textsIn('fr')('push.note', { note: 'Pour toi', title: 'Titre' }), '« Pour toi » · Titre')
  })
})
