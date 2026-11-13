import { titleKey } from './text.ts'

// "Tendances · 48 h" in the search: the phrases most titles share, written as the sources write them.
// No AI: word sequences counted across the titles, longest first when they are as common.

// Words a trend never starts or ends with (French and English), on top of short ones.
const STOP_WORDS = new Set(
  (
    'les des une aux pour par sur dans avec sans sous entre vers chez plus moins tres tout tous toute toutes ' +
    'est sont ont fait font etre avoir ete qui que quoi dont mais donc car ses son sa leur leurs cette ces cet ' +
    'nous vous ils elles lui elle apres avant depuis encore aussi comme quand selon contre deja nouveau nouvelle ' +
    'premier premiere enfin pourquoi comment voici annonce test video ' +
    'the and for with from that this what when where who why how are was were has have had will would ' +
    'its into about after over under than then them they their new first review'
  ).split(' ')
)

const MAX_WORDS = 3
const MIN_ARTICLES = 3

export interface TrendTitle {
  title: string
  topicId: string
}

export interface Trend {
  label: string
  // Articles whose title holds it.
  count: number
  // The topic most of those articles are listed in: the dot beside it.
  topicId: string
}

const significant = (key: string) => (key.length >= 3 || /\d/.test(key)) && !STOP_WORDS.has(key)

// A title's words, each as written (punctuation trimmed) and as compared (no accents or case).
const wordsOf = (title: string) =>
  title
    .split(/\s+/)
    .map(raw => raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean)
    .map(text => ({ text, key: titleKey(text) }))

interface Candidate {
  forms: Map<string, number>
  topics: Map<string, number>
  articles: Set<number>
}

const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1)
const mostCommon = (map: Map<string, number>) => [...map.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''

// A phrase that may name a subject: it starts and ends with a significant word, and a single word is a name or
// holds a digit ("Bruxelles", "2027", not "budget"), without being a number alone.
const couldTrend = (phrase: ReturnType<typeof wordsOf>) => {
  const first = phrase[0]
  const last = phrase[phrase.length - 1]
  if (!first || !last || !significant(first.key) || !significant(last.key)) return false
  if (phrase.length > 1) return true
  return (/^\p{Lu}/u.test(first.text) || /\d/.test(first.text)) && !/^\d+$/.test(first.text)
}

export const trendsOf = (titles: TrendTitle[], limit = 5): Trend[] => {
  const candidates = new Map<string, Candidate>()

  titles.forEach(({ title, topicId }, index) => {
    const words = wordsOf(title)
    for (let start = 0; start < words.length; start++) {
      for (let length = 1; length <= MAX_WORDS && start + length <= words.length; length++) {
        const phrase = words.slice(start, start + length)
        if (!couldTrend(phrase)) continue

        const key = phrase.map(word => word.key).join(' ')
        const candidate = candidates.get(key) ?? { forms: new Map(), topics: new Map(), articles: new Set() }
        if (candidate.articles.has(index)) continue
        candidate.articles.add(index)
        bump(candidate.forms, phrase.map(word => word.text).join(' '))
        bump(candidate.topics, topicId)
        candidates.set(key, candidate)
      }
    }
  })

  const common = [...candidates.entries()]
    .filter(([, candidate]) => candidate.articles.size >= MIN_ARTICLES)
    // The most articles first; a longer phrase wins over the shorter ones as common as it.
    .sort(
      ([keyA, a], [keyB, b]) => b.articles.size - a.articles.size || keyB.split(' ').length - keyA.split(' ').length
    )

  const chosen: { key: string; candidate: Candidate }[] = []
  for (const [key, candidate] of common) {
    if (chosen.length === limit) break
    // One trend per story: a phrase sharing a word with a chosen one ("Forza" after "Forza Horizon 6") is left out.
    const words = key.split(' ')
    if (chosen.some(other => other.key.split(' ').some(word => words.includes(word)))) continue
    chosen.push({ key, candidate })
  }

  return chosen.map(({ candidate }) => ({
    // Capitalized like a name, as the search shows it: "Budget 2027".
    label: mostCommon(candidate.forms).replace(/^\p{Ll}/u, letter => letter.toUpperCase()),
    count: candidate.articles.size,
    topicId: mostCommon(candidate.topics)
  }))
}
