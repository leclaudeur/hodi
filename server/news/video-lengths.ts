import type { NewsStore } from '../db/news-store.ts'
import type { FeedItem } from './feed-parser.ts'
import type { FetchVideoDuration } from './video-durations.ts'

const MAX_SHORT_SECONDS = 60
// A video page that gave no length is read again after this.
const DURATION_RETRY_MS = 60 * 60 * 1000

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

// The length of each video in Vidéos, read from its page once and kept in the store.
export class VideoLengths {
  readonly #store: NewsStore
  readonly #fetchVideoDuration: FetchVideoDuration
  readonly #now: () => number
  readonly #log: (message: string) => void
  // Videos whose length is being read, one page at a time.
  readonly #queue = new Set<string>()
  #reading = false

  constructor(options: {
    store: NewsStore
    fetchVideoDuration: FetchVideoDuration
    now: () => number
    log: (message: string) => void
  }) {
    this.#store = options.store
    this.#fetchVideoDuration = options.fetchVideoDuration
    this.#now = options.now
    this.#log = options.log
  }

  // Each video with its length when known; the others are read in the background, for the next visit.
  // A Short that its feed didn't mark as one (a minute or less) leaves the list.
  apply<T extends { items: FeedItem[] }>(sections: T[]): T[] {
    const videoIds = sections.flatMap(section =>
      section.items.flatMap(item => (item.media?.type === 'youtube' ? [item.media.videoId] : []))
    )
    const known = this.#store.getVideoDurations([...new Set(videoIds)], this.#now() - DURATION_RETRY_MS)
    for (const id of videoIds) if (!known.has(id)) this.#queue.add(id)
    void this.#read()

    return sections.map(section => ({
      ...section,
      items: section.items.flatMap(item => {
        if (item.media?.type !== 'youtube') return [item]
        const seconds = known.get(item.media.videoId)
        if (seconds == null) return [item]
        if (seconds <= MAX_SHORT_SECONDS) return []
        return [{ ...item, media: { ...item.media, durationSeconds: seconds } }]
      })
    }))
  }

  async #read() {
    if (this.#reading) return
    this.#reading = true
    try {
      for (const id of this.#queue) {
        this.#queue.delete(id)
        const seconds = await this.#fetchVideoDuration(id).catch((error: unknown) => {
          this.#log(`Video length ${id}: ${errorMessage(error)}`)
          return null
        })
        this.#store.saveVideoDuration(id, seconds, this.#now())
      }
    } finally {
      this.#reading = false
    }
  }
}
