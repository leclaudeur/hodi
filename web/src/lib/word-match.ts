// Kept in step with server/news/word-match.ts.

const ROMAN = [
  '',
  'i',
  'ii',
  'iii',
  'iv',
  'v',
  'vi',
  'vii',
  'viii',
  'ix',
  'x',
  'xi',
  'xii',
  'xiii',
  'xiv',
  'xv',
  'xvi',
  'xvii',
  'xviii',
  'xix',
  'xx'
]

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Lowercase, without accents: the form words are compared in.
export const foldText = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

// Finds a word or phrase at the start of a word: "foot" finds "football", "IA" not "via".
// A number stands whole ("6" not in "2026"), and after a name it is also found in Roman numerals ("GTA 6", "GTA VI").
export const wordPattern = (word: string) => {
  const folded = foldText(word.trim())
  const numbered = folded.match(/^(.*\S)\s+(\d+)$/)
  const number = numbered ? Number(numbered[2]) : NaN
  const body = numbered
    ? `${escape(numbered[1] ?? '')}\\s+(?:${numbered[2]}${ROMAN[number] ? `|${ROMAN[number]}` : ''})(?![\\p{L}\\p{N}])`
    : /\d$/.test(folded)
      ? `${escape(folded)}(?!\\p{N})`
      : escape(folded)
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${body}`, 'u')
}
