import { useSyncExternalStore } from 'react'
import { clockTime } from './format.ts'
import { t } from './i18n.ts'
import {
  type DailySummaryPoint,
  type DailySummaryResult,
  UnauthorizedError,
  getDailySummary,
  writeDailySummary
} from '../api.ts'
import { aiLeft, refreshAiUsage } from './ai-left.ts'
import { type Preferences, orderTopics } from './preferences.ts'
import { showError } from './toast.ts'

// The last "Résumé du jour", shared by its bubble at the head of "À la une" and its story. Reading it is free;
// writing one is a click (the bubble when none is written, the story's violet buttons), never automatic.
let current: DailySummaryResult | null = null
const listeners = new Set<() => void>()

export const setDailySummary = (dailySummary: DailySummaryResult) => {
  current = dailySummary
  listeners.forEach(listener => listener())
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// The day's only: past midnight, yesterday's daily summary makes way for the button, even in an app left open.
const NONE: DailySummaryResult = { status: 'none' }
const ofToday = (dailySummary: DailySummaryResult | null) =>
  dailySummary?.status === 'ok' && new Date(dailySummary.generatedAt).toDateString() !== new Date().toDateString()
    ? NONE
    : dailySummary

export const useDailySummary = () => useSyncExternalStore(subscribe, () => ofToday(current))

// The server writes the daily summary once the front page is gathered: asked again until then, only after the click.
const POLL_INTERVAL_MS = 4000
const MAX_POLLS = 12

let writing = false

const setWriting = (next: boolean) => {
  writing = next
  listeners.forEach(listener => listener())
}

export const useDailySummaryWriting = () => useSyncExternalStore(subscribe, () => writing)

export const DAILY_SUMMARY_ERRORS: Partial<
  Record<DailySummaryResult['status'], `dailySummary.errors.${'failed' | 'refused' | 'limited'}`>
> = {
  failed: 'dailySummary.errors.failed',
  refused: 'dailySummary.errors.refused',
  limited: 'dailySummary.errors.limited'
}

// Said in a toast too: writing takes a while, the page may be left meanwhile, and a daily summary already
// shown stays on it.
const reportFailure = (status: DailySummaryResult['status']) => {
  const message = DAILY_SUMMARY_ERRORS[status]
  if (message) showError(status === 'failed' ? `${t(message)} ${t('common.tryAgainSoon')}` : t(message))
}

// Asks the server until it is done writing, a few times at most: still pending then counts as failed.
const pollDailySummary = async (): Promise<DailySummaryResult> => {
  for (let polls = 1; ; polls++) {
    const next = await writeDailySummary()
    if (next.status !== 'pending' || polls >= MAX_POLLS) return next.status === 'pending' ? { status: 'failed' } : next
    await new Promise(resolve => window.setTimeout(resolve, POLL_INTERVAL_MS))
  }
}

// Writes a new daily summary: the bubble or the story's violet buttons, once at a time. Throws UnauthorizedError only.
export const requestDailySummary = async () => {
  if (writing) return
  // The day's cap reached: said at once, no call is made.
  if (aiLeft('dailySummary') === 0) {
    reportFailure('limited')
    return
  }
  setWriting(true)
  try {
    const result = await pollDailySummary()
    reportFailure(result.status)
    // A daily summary already shown stays when writing a new one fails.
    if (result.status === 'ok' || ofToday(current)?.status !== 'ok') setDailySummary(result)
  } catch (error) {
    if (error instanceof UnauthorizedError) throw error
    reportFailure('failed')
    if (ofToday(current)?.status !== 'ok') setDailySummary({ status: 'failed' })
  } finally {
    setWriting(false)
    void refreshAiUsage()
  }
}

// Asked again on each visit of the bubble or the story: another device may have written one since.
let loadedAt = 0

export const loadDailySummary = () =>
  getDailySummary().then(dailySummary => {
    loadedAt = Date.now()
    setDailySummary(dailySummary)
  })

// On each visit of "À la une", unless it was just asked with the front page (lib/front-page.ts).
export const refreshDailySummary = () => (Date.now() - loadedAt < 30_000 ? Promise.resolve() : loadDailySummary())

// "08:12", or "HIER 22:40": when the daily summary was written, under its story.
export const writtenAt = (iso: string, now = Date.now()) => {
  const date = new Date(iso)
  const today = new Date(now).toDateString() === date.toDateString()
  return today ? clockTime(date) : t('dailySummary.yesterdayAt', { time: clockTime(date) })
}

export interface DailySummaryGroup {
  topicId: string | null
  label: string
  points: DailySummaryPoint[]
}

// The points by topic, in the reader's order of topics; points from elsewhere come last.
export const groupsOf = (points: DailySummaryPoint[], preferences: Preferences): DailySummaryGroup[] => {
  const groups = new Map<string, DailySummaryGroup>()
  for (const point of points) {
    const key = point.topicId ?? `other:${point.topic}`
    const group = groups.get(key) ?? { topicId: point.topicId, label: point.topic, points: [] }
    group.points.push(point)
    groups.set(key, group)
  }
  return orderTopics(
    [...groups.entries()].map(([id, group]) => ({ id, label: group.label, group })),
    preferences
  ).map(({ group }) => group)
}

// Reading time, at 230 words a minute.
export const readingMinutes = (points: DailySummaryPoint[]) =>
  Math.max(
    1,
    Math.round(
      points
        .map(point => point.text)
        .join(' ')
        .split(/\s+/).length / 230
    )
  )

// The daily summary is seen once its story was opened: its bubble then turns grey, as a topic's.
export const dailySummaryStoryId = (generatedAt: string) => `daily-summary:${generatedAt}`
