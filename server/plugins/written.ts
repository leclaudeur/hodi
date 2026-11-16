import { LANGUAGES, type Language } from '../../shared/i18n.ts'

// A text a plugin writes for the server's admin (a notice, a row of the weekly report): one text, or one per language,
// { fr, en }, so that each admin reads it in their own. An admin whose language it lacks gets the French, or the other.
export type Written = string | Partial<Record<Language, string>>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// The text trimmed, or null when it, or any of its languages, fails the check or names a language Hodi does not know.
export const writtenOf = (value: unknown, fits: (text: unknown) => text is string): Written | null => {
  if (typeof value === 'string') return fits(value) ? value.trim() : null
  if (!isRecord(value)) return null
  const entries = Object.entries(value)
  if (
    entries.length === 0 ||
    entries.some(([language, text]) => !LANGUAGES.includes(language as Language) || !fits(text))
  )
    return null
  return Object.fromEntries(entries.map(([language, text]) => [language, (text as string).trim()]))
}

export const writtenIn = (written: Written, language: Language): string =>
  typeof written === 'string' ? written : (written[language] ?? written.fr ?? Object.values(written)[0]!)
