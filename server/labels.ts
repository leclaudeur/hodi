import { LANGUAGES, type Language } from '../shared/i18n.ts'

// A name written in sources.yml or gamification.yml: one for every language ("Tech"), or one per language
// ({ fr: Belgique, en: Belgium }). A language left out shows another one given, French first.
export type Labels = Partial<Record<Language, string>>

export interface Labelled {
  // The French name, else the other one given, for logs, the source list and tests that build a catalog by hand.
  label: string
  labels?: Labels
}

export const parseLabels = (value: unknown, where: string, fail: (where: string, message: string) => never) => {
  if (typeof value === 'string' && value.trim() !== '') return { label: value.trim() }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(where, `expected a name, or one per language (${LANGUAGES.join(', ')})`)
  }
  const labels: Labels = {}
  for (const [language, label] of Object.entries(value)) {
    if (!LANGUAGES.includes(language as Language))
      fail(`${where}.${language}`, `expected one of ${LANGUAGES.join(', ')}`)
    if (typeof label !== 'string' || label.trim() === '') fail(`${where}.${language}`, 'expected a non-empty string')
    labels[language as Language] = (label as string).trim()
  }
  const first = LANGUAGES.map(language => labels[language]).find(label => label !== undefined)
  return first === undefined ? fail(where, 'expected at least one name') : { label: first, labels }
}

export const labelIn = (named: Labelled, language: Language) => named.labels?.[language] ?? named.label
