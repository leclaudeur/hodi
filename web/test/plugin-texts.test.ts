import { describe, expect, it } from 'vitest'
import { pluginDescription, pluginName } from '../src/plugins/plugin-texts.ts'

const plugin = {
  name: 'Bonjour',
  description: 'Dit bonjour.',
  translations: { en: { name: 'Hello', description: 'Says hello.' }, de: { name: 'Hallo' } }
}

describe('a plugin’s name and description', () => {
  it('reads its locales in the language shown, region or not', () => {
    expect([pluginName(plugin, 'en'), pluginDescription(plugin, 'en-GB')]).toEqual(['Hello', 'Says hello.'])
  })

  it('falls back on plugin.json where a language has none', () => {
    expect([pluginName(plugin, 'fr'), pluginDescription(plugin, 'de')]).toEqual(['Bonjour', 'Dit bonjour.'])
    expect(pluginDescription({ name: 'Bonjour', translations: {} }, 'en')).toBeNull()
  })
})
