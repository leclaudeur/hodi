import { eld } from 'eld/small'
import type { Language } from './catalog.ts'

// eld tells languages apart by their n-grams, so a short title is enough where common words were not. Only the
// languages Hodi reads are compared.
eld.setLanguageSubset(['fr', 'en'])

// Below this, one borrowed word (a name, "Summary", "Football") can tip the guess: unsure.
const MIN_WORDS = 5

// The language a text is in, when eld is sure of it; null when unsure.
export const guessLanguage = (text: string): Language | null => {
  if ((text.match(/\p{L}+/gu) ?? []).length < MIN_WORDS) return null
  const result = eld.detect(text)
  if (!result.isReliable()) return null
  return result.language === 'fr' || result.language === 'en' ? result.language : null
}
