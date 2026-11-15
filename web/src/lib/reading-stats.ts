import { refreshGameSoon } from './game.ts'
import { changeUserState, getUserState } from './user-state.ts'

// What was read and when, for the stats page. Kept on the server and shared by every device.

export interface ReadingEntry {
  id: string
  sourceId: string
  sourceName: string
  topicId?: string | null
  // When the article was first opened (ms).
  at: number
  // The time really spent on an article (estimated, before it was tracked), or the length of a video or an episode.
  minutes: number
  // Left out before videos counted: an article.
  kind?: 'article' | 'video' | 'podcast'
  // Articles: read for good, or only skimmed. Left out before it was tracked, and for videos: counted as read.
  done?: boolean
  // How far the text went (0 to 1), and where it was left.
  progress?: number
  position?: number
  // The estimated reading time.
  estimate?: number
}

export type ReadingProgress = Pick<Required<ReadingEntry>, 'minutes' | 'progress' | 'position' | 'done'> &
  Pick<ReadingEntry, 'estimate'>

// The stats can't hold more than 10 hours for one entry.
const MAX_MINUTES = 600

export const getReadings = (): ReadingEntry[] => getUserState().readings

// Each article or video counts once, on the day it was first opened.
export const recordReading = (entry: Omit<ReadingEntry, 'at'>, now = Date.now()) => {
  if (getUserState().readings.some(other => other.id === entry.id)) return

  const reading = {
    ...entry,
    topicId: entry.topicId ?? null,
    minutes: Math.min(MAX_MINUTES, Math.round(entry.minutes * 10) / 10),
    kind: entry.kind ?? 'article',
    at: now
  }
  changeUserState(state => ({ ...state, readings: [...state.readings, reading] }), {
    method: 'POST',
    path: '/readings',
    body: { readings: [reading] }
  })
  if (isRead(reading)) refreshGameSoon()
}

// How much of an open article was read. Never less than before on the server, but the position it was left at.
export const updateReading = (id: string, change: ReadingProgress) => {
  // Points come when an article turns "lu": once.
  const earns = change.done && getUserState().readings.some(entry => entry.id === id && entry.done === false)
  changeUserState(
    state => ({
      ...state,
      readings: state.readings.map(entry =>
        entry.id === id
          ? {
              ...entry,
              minutes: Math.max(entry.minutes, change.minutes),
              progress: Math.max(entry.progress ?? 0, change.progress),
              position: change.position,
              done: entry.done === true || change.done,
              estimate: change.estimate ?? entry.estimate
            }
          : entry
      )
    }),
    // When it happened, for the points of a reading made offline: they go to that day.
    { method: 'PATCH', path: `/readings/${encodeURIComponent(id)}`, body: { ...change, at: Date.now() } }
  )
  if (earns) refreshGameSoon()
}

// Read, as opposed to opened and left: what the stats count.
export const isRead = (entry: ReadingEntry) => entry.done !== false

export const isVideoReading = (entry: ReadingEntry) => entry.kind === 'video' || entry.kind === 'podcast'

export const clearReadings = () =>
  changeUserState(state => ({ ...state, readings: [] }), { method: 'DELETE', path: '/readings' })

export const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())
