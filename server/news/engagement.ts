// "Peu ouvertes": how much of each source a profile opens, over the last 30 days, from what is already
// kept (articles and videos listed, readings). No AI: the numbers alone say which sources it passes over.
// Sites and channels are judged apart: a channel posts far less, and a video is not opened as an article is.

export const ENGAGEMENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
// Not before the profile has read for this long: the window starts at its first reading, so a new reader's
// few days are not set against a month of articles.
export const MIN_HISTORY_MS = 14 * 24 * 60 * 60 * 1000
// Below these, too little to judge: a quiet source, or a profile that has barely read yet.
export const MIN_ARTICLES = 15
export const MIN_PROFILE_READS = 20
export const CHANNEL_LIMITS = { minItems: 4, minProfileReads: 5 }
// A source is little read under a quarter of the profile's usual share, and always under 2 %.
const LOW_SHARE_OF_MEDIAN = 0.25
const LOW_RATE_FLOOR = 0.02

export interface SourceEngagement {
  id: string
  articles: number
  read: number
  low: boolean
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length === 0
    ? 0
    : sorted.length % 2
      ? (sorted[middle] ?? 0)
      : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}

// sources: the ones the profile shows; articles and reads by source id over the window.
export const sourceEngagement = (
  sources: string[],
  articles: ReadonlyMap<string, number>,
  reads: ReadonlyMap<string, number>,
  { minItems = MIN_ARTICLES, minProfileReads = MIN_PROFILE_READS } = {}
): SourceEngagement[] => {
  const rows = sources.map(id => ({
    id,
    articles: articles.get(id) ?? 0,
    read: Math.min(reads.get(id) ?? 0, articles.get(id) ?? 0)
  }))
  const judged = rows.filter(row => row.articles >= minItems)
  const totalReads = rows.reduce((sum, row) => sum + row.read, 0)
  const threshold = Math.max(LOW_RATE_FLOOR, median(judged.map(row => row.read / row.articles)) * LOW_SHARE_OF_MEDIAN)
  return rows.map(row => ({
    ...row,
    low: totalReads >= minProfileReads && row.articles >= minItems && row.read / row.articles < threshold
  }))
}
