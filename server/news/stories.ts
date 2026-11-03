import { titleKey } from './text.ts'

// Words that say nothing about the story itself (French and English).
const STOP_WORDS = new Set(
  (
    'les des une aux pour par sur dans avec sans sous entre vers chez plus moins tres tout tous toute toutes ' +
    'est sont ont fait font etre avoir ete qui que quoi dont mais donc car ses son sa leur leurs cette ces cet ' +
    'nous vous ils elles lui elle apres avant depuis encore aussi comme quand selon contre deja ' +
    'the and for with from that this what when where who why how are was were has have had will would ' +
    'its into about after over under than then them they their'
  ).split(' ')
)

// Significant words of a title: accents and case dropped, short and common words left out.
export const storyWords = (title: string) =>
  new Set(
    titleKey(title)
      .split(' ')
      .filter(word => (word.length >= 3 || /\d/.test(word)) && !STOP_WORDS.has(word))
  )

// Names in a title (capitalized words that do not start a sentence): "Liège", "Zelensky", "BCE".
const properNames = (title: string) => {
  const names = new Set<string>()

  title.split(/(?<=[:.!?«"—–-])\s+|\s+(?=[:—–-])/).forEach(part => {
    part
      .split(/\s+/)
      .slice(1)
      .filter(word => /^\p{Lu}/u.test(word))
      .forEach(word => names.add(titleKey(word)))
  })

  return names
}

// Two articles on the same story share most of their title's significant words,
// and come out close in time.
const MAX_GAP_MS = 36 * 60 * 60 * 1000

export interface StoryCandidate {
  title: string
  publishedAt: string | null
}

interface TitleAnalysis {
  key: string
  words: Set<string>
  names: Set<string>
}

// A topic compares every pair of its titles: analyse each title once.
const analyses = new Map<string, TitleAnalysis>()
const MAX_ANALYSES = 5000

const analyse = (title: string) => {
  let analysis = analyses.get(title)

  if (!analysis) {
    if (analyses.size >= MAX_ANALYSES) analyses.clear()
    analysis = { key: titleKey(title), words: storyWords(title), names: properNames(title) }
    analyses.set(title, analysis)
  }

  return analysis
}

export const sameStory = (a: StoryCandidate, b: StoryCandidate) => {
  const { key: keyA, words: wordsA, names: namesA } = analyse(a.title)
  const { key: keyB, words: wordsB, names: namesB } = analyse(b.title)

  if (keyA === keyB) return true

  if (a.publishedAt && b.publishedAt) {
    const gap = Math.abs(Date.parse(a.publishedAt) - Date.parse(b.publishedAt))
    if (gap > MAX_GAP_MS) return false
  }

  // "Incendie à Liège" and "Incendie à Charleroi" are two stories.
  const ownName = (names: Set<string>, otherWords: Set<string>) =>
    [...names].some(name => name && !otherWords.has(name) && !name.includes(' '))
  if (ownName(namesA, wordsB) && ownName(namesB, wordsA)) return false

  const shared = [...wordsA].filter(word => wordsB.has(word)).length
  const union = new Set([...wordsA, ...wordsB]).size
  const overlap = shared / Math.max(1, Math.min(wordsA.size, wordsB.size))

  // Many words in common, or nearly the same few words.
  return (shared >= 4 && overlap >= 0.6) || (shared >= 3 && shared / union >= 0.75)
}
