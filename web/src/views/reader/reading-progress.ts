import { type RefObject, useEffect } from 'react'
import { type ReadingProgress, getReadings, recordReading, updateReading } from '../../lib/reading-stats.ts'
import { forgetResumePosition, resumePositionOf } from '../../lib/resume.ts'

// An article counts as read once this much of it scrolled by AND this share of its estimated time was spent: scrolling
// to the end alone does not read it (it earns the game's points), nor does leaving it open. The estimate is at about
// 230 words a minute: 35% still lets a fast reader through.
const DONE_PROGRESS = 0.8
const DONE_TIME = 0.35
// An article left open counts no more than twice its estimated time.
const MAX_TIME = 2
const MINUTE_MS = 60 * 1000

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
    const needed = Math.min(estimate, exact) * DONE_TIME
    recordReading({ id, sourceId, sourceName, minutes: 0, estimate, done: false, progress: 0, position: 0 })
    const entry = getReadings().find(other => other.id === id)
    // Opened before it was tracked: it stays counted as read, as it was.
    if (entry?.done === undefined) return

    const before = entry.minutes
    let furthest = entry.progress ?? 0
    let position = entry.position ?? 0
    let spentMs = 0
    // Time counts only while the reader is in front: the tab shown and the window focused, not left open behind
    // another app.
    const attentive = () => document.visibilityState === 'visible' && document.hasFocus()
    let visibleSince = attentive() ? performance.now() : null
    let done = entry.done
    // A short text shows whole at once: only its time says it was read, and it is then read to its end.
    let fits = false
    let frame = 0
    let timer = 0

    const current = (): ReadingProgress => {
      const running = visibleSince === null ? 0 : performance.now() - visibleSince
      const minutes = Math.min(Math.max(1, estimate) * MAX_TIME, before + (spentMs + running) / MINUTE_MS)
      // A short text shows whole at once: its time alone says it was read.
      done ||= readForGood({ minutes, needed, estimate, fits, furthest })
      if (done && fits) furthest = position = 1
      return {
        minutes: Math.round(minutes * 10) / 10,
        progress: hundredths(furthest),
        position: hundredths(position),
        done
      }
    }

    // Nothing to send while nothing changed.
    let last = JSON.stringify(current())
    const send = () => {
      const change = current()
      const key = JSON.stringify(change)
      if (key === last) return
      last = key
      updateReading(id, change)
    }

    const measure = () => {
      frame = 0
      if (!target.current) return
      fits = textFits(target.current)
      if (!fits) {
        position = textProgress(target.current)
        furthest = Math.max(furthest, position)
      }
      // Read for good: said at once, not only when the article is left.
      if (!done && current().done) send()
    }

    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(measure)
    }

    // Read for good once its time has passed (for a long text, once scrolled too): one timer, while in front.
    const waitForTime = () => {
      window.clearTimeout(timer)
      if (done || estimate <= 0 || visibleSince === null) return
      const left = (needed - current().minutes) * MINUTE_MS
      timer = window.setTimeout(
        () => {
          if (!done && current().done) send()
          else waitForTime()
        },
        Math.max(1000, left)
      )
    }

    const attention = () => {
      if (attentive()) {
        visibleSince ??= performance.now()
        waitForTime()
        return
      }
      window.clearTimeout(timer)
      if (visibleSince !== null) spentMs += performance.now() - visibleSince
      visibleSince = null
      send()
    }

    // Opened from "Reprendre": back where it was left, once the text is laid out.
    const resumeAt = resumePositionOf(id)
    const resume =
      resumeAt === null
        ? 0
        : window.requestAnimationFrame(() => {
            if (!target.current) return
            scrollToProgress(target.current, resumeAt)
            forgetResumePosition()
          })

    // Measured once laid out too, and when images or a new text size change its length: a short text never scrolls.
    const resizes = new ResizeObserver(schedule)
    if (target.current) resizes.observe(target.current)
    schedule()
    waitForTime()

    document.addEventListener('scroll', schedule, { capture: true, passive: true })
    document.addEventListener('visibilitychange', attention)
    window.addEventListener('focus', attention)
    window.addEventListener('blur', attention)
    return () => {
      window.cancelAnimationFrame(resume)
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timer)
      resizes.disconnect()
      document.removeEventListener('scroll', schedule, { capture: true })
      document.removeEventListener('visibilitychange', attention)
      window.removeEventListener('focus', attention)
      window.removeEventListener('blur', attention)
      send()
    }
  }, [target, id, sourceId, sourceName, estimate, exact])
}
