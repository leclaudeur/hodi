import { type RefObject, useEffect } from 'react'
import {
  type ReadingEntry,
  type ReadingProgress,
  getReadings,
  recordReading,
  updateReading
} from '../../lib/reading-stats.ts'
import { forgetResumePosition, resumePositionOf } from '../../lib/resume.ts'
import { MINUTE_MS } from '../../../../shared/time.ts'

// An article counts as read once this much of it scrolled by AND this share of its estimated time was spent: scrolling
// to the end alone does not read it (it earns the game's points), nor does leaving it open. The estimate is at about
// 230 words a minute: 35% still lets a fast reader through.
const DONE_PROGRESS = 0.8
const DONE_TIME = 0.35
// An article left open counts no more than twice its estimated time.
const MAX_TIME = 2

// The scrolling box an element is in: the desktop panel, or the page itself on a phone.
const scrollerOf = (element: HTMLElement): HTMLElement => {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const { overflowY } = window.getComputedStyle(parent)
    if ((overflowY === 'auto' || overflowY === 'scroll') && parent.scrollHeight > parent.clientHeight) return parent
  }
  return document.scrollingElement as HTMLElement
}

// How far the box scrolls before the text's last line shows.
const travelOf = (element: HTMLElement, scroller: HTMLElement) => {
  const isPage = scroller === document.scrollingElement
  const top = isPage ? 0 : scroller.getBoundingClientRect().top
  const height = isPage ? window.innerHeight : scroller.clientHeight
  return element.getBoundingClientRect().bottom - top + scroller.scrollTop - height
}

// Whether the whole text shows without a scroll: a short article.
export const textFits = (element: HTMLElement) => travelOf(element, scrollerOf(element)) <= 0

// How far the text went, from 0 to 1 once its last line shows (at once for a text that fits).
export const textProgress = (element: HTMLElement) => {
  const scroller = scrollerOf(element)
  const end = travelOf(element, scroller)
  return end <= 0 ? 1 : Math.min(1, Math.max(0, scroller.scrollTop / end))
}

// Back where the text was left ("Reprendre").
const scrollToProgress = (element: HTMLElement, progress: number) => {
  const scroller = scrollerOf(element)
  scroller.scrollTo({ top: Math.max(0, travelOf(element, scroller)) * progress })
}

const hundredths = (fraction: number) => Math.round(fraction * 100) / 100

// Whether an article now counts as read: enough of its time spent, and, unless the whole text shows at once, enough of
// it scrolled by. `needed` is that time in minutes.
export const readForGood = (reading: {
  minutes: number
  needed: number
  estimate: number
  fits: boolean
  furthest: number
}) => reading.estimate > 0 && reading.minutes >= reading.needed && (reading.fits || reading.furthest >= DONE_PROGRESS)

interface Tracked {
  id: string
  sourceId: string
  sourceName: string
  // Estimated minutes, whole.
  estimate: number
  // The same, unrounded: a text of a few lines is read in seconds.
  exact: number
}

// What was read of one article while it is open, sent to the stats as it changes. The listeners are its arrow
// properties, so that they can be removed as they were added.
class ReadingTracker {
  private readonly before: number
  private furthest: number
  private position: number
  private spentMs = 0
  private visibleSince: number | null
  private done: boolean
  // A short text shows whole at once: only its time says it was read, and it is then read to its end.
  private fits = false
  private frame = 0
  private timer = 0
  private resume = 0
  // Nothing to send while nothing changed.
  private last: string
  private readonly resizes = new ResizeObserver(() => this.schedule())

  constructor(
    private readonly target: RefObject<HTMLElement | null>,
    private readonly id: string,
    private readonly estimate: number,
    private readonly needed: number,
    entry: ReadingEntry & { done: boolean }
  ) {
    this.before = entry.minutes
    this.furthest = entry.progress ?? 0
    this.position = entry.position ?? 0
    this.visibleSince = attentive() ? performance.now() : null
    this.done = entry.done
    this.last = JSON.stringify(this.current())
  }

  private current(): ReadingProgress {
    const running = this.visibleSince === null ? 0 : performance.now() - this.visibleSince
    const minutes = Math.min(Math.max(1, this.estimate) * MAX_TIME, this.before + (this.spentMs + running) / MINUTE_MS)
    const { needed, estimate, fits, furthest } = this
    // A short text shows whole at once: its time alone says it was read.
    this.done ||= readForGood({ minutes, needed, estimate, fits, furthest })
    if (this.done && this.fits) this.furthest = this.position = 1
    return {
      minutes: Math.round(minutes * 10) / 10,
      progress: hundredths(this.furthest),
      position: hundredths(this.position),
      done: this.done
    }
  }

  private send = () => {
    const change = this.current()
    const key = JSON.stringify(change)
    if (key === this.last) return
    this.last = key
    updateReading(this.id, change)
  }

  private measure = () => {
    this.frame = 0
    if (!this.target.current) return
    this.fits = textFits(this.target.current)
    if (!this.fits) {
      this.position = textProgress(this.target.current)
      this.furthest = Math.max(this.furthest, this.position)
    }
    // Read for good: said at once, not only when the article is left.
    if (!this.done && this.current().done) this.send()
  }

  private schedule = () => {
    if (!this.frame) this.frame = window.requestAnimationFrame(this.measure)
  }

  // Read for good once its time has passed (for a long text, once scrolled too): one timer, while in front.
  private waitForTime = () => {
    window.clearTimeout(this.timer)
    if (this.done || this.estimate <= 0 || this.visibleSince === null) return
    const left = (this.needed - this.current().minutes) * MINUTE_MS
    this.timer = window.setTimeout(
      () => {
        if (!this.done && this.current().done) this.send()
        else this.waitForTime()
      },
      Math.max(1000, left)
    )
  }

  private attention = () => {
    if (attentive()) {
      this.visibleSince ??= performance.now()
      this.waitForTime()
      return
    }
    window.clearTimeout(this.timer)
    if (this.visibleSince !== null) this.spentMs += performance.now() - this.visibleSince
    this.visibleSince = null
    this.send()
  }

  start() {
    // Opened from "Reprendre": back where it was left, once the text is laid out.
    const resumeAt = resumePositionOf(this.id)
    if (resumeAt !== null)
      this.resume = window.requestAnimationFrame(() => {
        if (!this.target.current) return
        scrollToProgress(this.target.current, resumeAt)
        forgetResumePosition()
      })

    // Measured once laid out too, and when images or a new text size change its length: a short text never scrolls.
    if (this.target.current) this.resizes.observe(this.target.current)
    this.schedule()
    this.waitForTime()

    document.addEventListener('scroll', this.schedule, { capture: true, passive: true })
    document.addEventListener('visibilitychange', this.attention)
    window.addEventListener('focus', this.attention)
    window.addEventListener('blur', this.attention)
  }

  stop() {
    window.cancelAnimationFrame(this.resume)
    window.cancelAnimationFrame(this.frame)
    window.clearTimeout(this.timer)
    this.resizes.disconnect()
    document.removeEventListener('scroll', this.schedule, { capture: true })
    document.removeEventListener('visibilitychange', this.attention)
    window.removeEventListener('focus', this.attention)
    window.removeEventListener('blur', this.attention)
    this.send()
  }
}

// Time counts only while the reader is in front: the tab shown and the window focused, not left open behind another
// app.
const attentive = () => document.visibilityState === 'visible' && document.hasFocus()

// Counts the article in the stats once its text shows, then what was really read of it: the time spent while
// the reader is in front and how far the text went. Sent when it is read for good, when the tab is hidden and when
// the article is left; measured on scroll and on resize, once per frame at most. One timer waits for the time
// that makes it read (all a short text has), and nothing else runs in between.
export const useReadingProgress = (target: RefObject<HTMLElement | null>, article: Tracked | null) => {
  const { id, sourceId, sourceName, estimate, exact } = article ?? {}

  useEffect(() => {
    if (
      id === undefined ||
      sourceId === undefined ||
      sourceName === undefined ||
      estimate === undefined ||
      exact === undefined
    )
      return
    recordReading({ id, sourceId, sourceName, minutes: 0, estimate, done: false, progress: 0, position: 0 })
    const entry = getReadings().find(other => other.id === id)
    // Opened before it was tracked: it stays counted as read, as it was.
    if (entry?.done === undefined) return
    const tracker = new ReadingTracker(target, id, estimate, Math.min(estimate, exact) * DONE_TIME, {
      ...entry,
      done: entry.done
    })
    tracker.start()
    return () => tracker.stop()
  }, [target, id, sourceId, sourceName, estimate, exact])
}
