import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PUBLIC_LIMITS } from './public-page.ts'
import { localesOf } from './web-parts.ts'

// A plugin's name and description in other languages: manifest.name and manifest.description in its
// locales/<language>.json. plugin.json keeps the reference text, shown where a language has none.
export interface ManifestText {
  name?: string
  description?: string
  // publicPages.title and publicPages.description: the default card of its public pages.
  publicTitle?: string
  publicDescription?: string
}
export type ManifestTranslations = Record<string, ManifestText>

// The same limits as plugin.json's name and description.
const LIMITS = { name: 60, description: 280 } as const

const clean = (value: unknown, max: number) =>
  typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : undefined

const textOf = (file: string): ManifestText => {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, Record<string, unknown> | undefined>
    const manifest = parsed.manifest ?? {}
    const pages = parsed.publicPages ?? {}
    const texts = {
      name: clean(manifest.name, LIMITS.name),
      description: clean(manifest.description, LIMITS.description),
      publicTitle: clean(pages.title, PUBLIC_LIMITS.title),
      publicDescription: clean(pages.description, PUBLIC_LIMITS.description)
    }
    return Object.fromEntries(Object.entries(texts).filter(([, text]) => text)) as ManifestText
  } catch {
    // A locale file that does not parse leaves plugin.json's texts: the web app reports the file itself.
    return {}
  }
}

export const manifestTranslations = (root: string): ManifestTranslations => {
  const translations: ManifestTranslations = {}
  for (const language of localesOf(root)) {
    const file = path.join(root, 'locales', `${language}.json`)
    const text = textOf(file)
    if (Object.keys(text).length) translations[language] = text
  }
  return translations
}
