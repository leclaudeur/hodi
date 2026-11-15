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
  // Single-word names only: "Liège", not "Pays Bas".
  names: string[]
}

// A topic compares every pair of its titles, on each request: analyse each title and read each date once.
const analyses = new Map<string, TitleAnalysis>()
const times = new Map<string, number>()
const MAX_ANALYSES = 5000

const analyse = (title: string) => {
  let analysis = analyses.get(title)

  if (!analysis) {
    if (analyses.size >= MAX_ANALYSES) analyses.clear()
    const names = [...properNames(title)].filter(name => name && !name.includes(' '))
    analysis = { key: titleKey(title), words: storyWords(title), names }
    analyses.set(title, analysis)
  }

  return analysis
}

const timeOf = (date: string) => {
  let time = times.get(date)
  if (time === undefined) {
    if (times.size >= MAX_ANALYSES) times.clear()
    time = Date.parse(date)
    times.set(date, time)
  }
  return time
}

const sharedCount = (a: Set<string>, b: Set<string>) => {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  let shared = 0
  for (const word of small) if (large.has(word)) shared++
  return shared
}

export const sameStory = (a: StoryCandidate, b: StoryCandidate) => {
  const { key: keyA, words: wordsA, names: namesA } = analyse(a.title)
  const { key: keyB, words: wordsB, names: namesB } = analyse(b.title)

  if (keyA === keyB) return true
  // Below three words in common, never the same story: the cheapest test first.
  if (wordsA.size < 3 || wordsB.size < 3) return false

  if (a.publishedAt && b.publishedAt && Math.abs(timeOf(a.publishedAt) - timeOf(b.publishedAt)) > MAX_GAP_MS) {
    return false
  }

  const shared = sharedCount(wordsA, wordsB)
  if (shared < 3) return false

  // "Incendie à Liège" and "Incendie à Charleroi" are two stories.
  const ownName = (names: string[], otherWords: Set<string>) => names.some(name => !otherWords.has(name))
  if (ownName(namesA, wordsB) && ownName(namesB, wordsA)) return false

  const union = wordsA.size + wordsB.size - shared
  const overlap = shared / Math.min(wordsA.size, wordsB.size)

  // Many words in common, or nearly the same few words.
  return (shared >= 4 && overlap >= 0.6) || shared / union >= 0.75
}
