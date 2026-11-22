import { readFileSync } from 'node:fs'
import path from 'node:path'
import { NOTICE_LIMITS } from './manifest-notices.ts'
import { localesOf } from './web-parts.ts'
import { CONFIG } from '../fixed-config.ts'

// A plugin's name and description in other languages: manifest.name and manifest.description in its
// locales/<language>.json. plugin.json keeps the reference text, shown where a language has none.
export interface ManifestText {
  name?: string
  description?: string
  // Its rows of Serveur › Notifications, by type: manifest.serverNotifications.<type>.label and .hint.
  serverNotifications?: Record<string, { label?: string; hint?: string }>
}
export type ManifestTranslations = Record<string, ManifestText>

// The same limits as plugin.json's name and description.
const LIMITS = {
  name: CONFIG.pluginManifest.nameMaxLength,
  description: CONFIG.pluginManifest.descriptionMaxLength
}

const clean = (value: unknown, max: number) =>
  typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : undefined

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const noticeTexts = (value: unknown): ManifestText['serverNotifications'] => {
  if (!isRecord(value)) return undefined
  const kept = Object.entries(value).flatMap(([type, entry]) => {
    if (!isRecord(entry)) return []
    const label = clean(entry.label, NOTICE_LIMITS.label)
    const hint = clean(entry.hint, NOTICE_LIMITS.hint)
    return label || hint ? [[type, { ...(label && { label }), ...(hint && { hint }) }] as const] : []
  })
  return kept.length ? Object.fromEntries(kept) : undefined
}

const textOf = (file: string): ManifestText => {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, Record<string, unknown> | undefined>
    const manifest = parsed.manifest ?? {}
    const texts = {
      name: clean(manifest.name, LIMITS.name),
      description: clean(manifest.description, LIMITS.description),
      serverNotifications: noticeTexts(manifest.serverNotifications)
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
