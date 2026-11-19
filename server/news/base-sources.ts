import type { Catalog, Language } from './catalog.ts'

// The household follows the base sources of every language: a profile reads the ones of its own language and has the
// others off, which it may turn on in Réglages › Sources.

interface HidingUser {
  hiddenSources(): string[]
  setPreferences(change: Record<string, unknown>, now: number): unknown
}

// The file's base sources that are not for this language.
export const otherBasesOf = (file: Catalog, language: Language) => [
  ...new Set(
    file.topics
      .flatMap(topic => topic.sources)
      .filter(source => source.base !== undefined && !source.base.includes(language))
      .map(source => source.id)
  )
]

// Turns these sources off in a profile's preferences, on the server: its devices get the change with the state.
export const hideSourcesOf = (user: HidingUser, ids: string[], now: number) => {
  const hidden = user.hiddenSources()
  const added = ids.filter(id => !hidden.includes(id))
  if (added.length > 0) user.setPreferences({ hiddenSources: [...hidden, ...added] }, now)
}
