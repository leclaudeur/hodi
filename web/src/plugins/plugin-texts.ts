import i18next from 'i18next'

// A plugin's name and description in other languages, from manifest.name and manifest.description in its locales
// (server/plugins/manifest-texts.ts). plugin.json's own texts are shown where a language has none.
export type PluginTranslations = Record<string, { name?: string; description?: string }>

interface Described {
  name: string
  description?: string | null
  translations: PluginTranslations
}

// « en-GB » reads the English texts.
const translationsIn = (plugin: Described, language: string) =>
  plugin.translations[language] ?? plugin.translations[language.slice(0, 2)]

// In the language shown now, unless told: the components calling these render again when it changes.
export const pluginName = (plugin: Described, language = i18next.language) =>
  translationsIn(plugin, language)?.name ?? plugin.name

export const pluginDescription = (plugin: Described, language = i18next.language) =>
  translationsIn(plugin, language)?.description ?? plugin.description ?? null
