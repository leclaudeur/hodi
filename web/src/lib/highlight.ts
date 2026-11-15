import { foldText } from '../../../shared/word-match.ts'

// The parts of a text that start with one of the searched words, as [start, end) ranges of the text itself.
// Compared without accents or case, like the search: "foret" marks "Forêt".
export const highlightRanges = (text: string, words: string[]): [number, number][] => {
  const folded: string[] = []
  // The index in the text of each folded character.
  const origin: number[] = []
  for (let index = 0; index < text.length; index++) {
    for (const character of foldText(text[index] ?? '')) {
      folded.push(character)
      origin.push(index)
    }
  }
  const foldedText = folded.join('')
  const ranges: [number, number][] = []

  for (const word of words.map(other => foldText(other.trim())).filter(Boolean)) {
    for (let at = foldedText.indexOf(word); at !== -1; at = foldedText.indexOf(word, at + 1)) {
      const before = foldedText[at - 1]
      if (before !== undefined && /[\p{L}\p{N}]/u.test(before)) continue
      const start = origin[at] ?? 0
      const end = (origin[at + word.length - 1] ?? start) + 1
      ranges.push([start, end])
    }
  }

  // Sorted and merged, so marks never overlap.
  return ranges
    .sort((a, b) => a[0] - b[0])
    .reduce<[number, number][]>((merged, range) => {
      const last = merged[merged.length - 1]
      if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1])
      else merged.push(range)
      return merged
    }, [])
}
