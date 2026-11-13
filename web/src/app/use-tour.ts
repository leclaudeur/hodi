import { useEffect, useRef, useState } from 'react'
import { TOPICS_CHANGED } from '../api.ts'
import { getPreferences, updatePreferences } from '../lib/preferences.ts'
import { goToTourStep } from '../lib/tour.ts'
import type { Step } from './tour-steps.ts'

// Room around what to press.
export const HOLE_PADDING = 6
// A page or a dialog takes a moment to open: the tour steps back only once it stays away.
const AWAY_MS = 500
const ADDED_PAUSE_MS = 900
// A target that hasn't come after this long won't: the bubble shows anyway, with "Passer".
const MISSING_MS = 1200

const shownTarget = (selector: string) =>
  [...document.querySelectorAll(selector)].find(element => {
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }) ?? null

const sameRect = (a: DOMRect | null, b: DOMRect | null) =>
  a === b || (!!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height)

// Out of the screen, or of a row that scrolls sideways (a phone's topics).
const offScreen = (box: DOMRect) =>
  box.top < 0 || box.bottom > window.innerHeight || box.left < 0 || box.right > window.innerWidth

// Since when a condition holds, frame after frame: null while it does not.
const since = (holds: boolean, from: number | null, time: number) => {
  if (!holds) return null
  return from ?? time
}

// Follows what to press as pages open, lists load and things scroll; steps back when its place is left.
export const useFollowTarget = (step: number | null, tourSteps: Step[]) => {
  // Where the light is: on the step's target once it shows (foundFor).
  const [rect, setRect] = useState<DOMRect | null>(null)
  // The target's own rounding, widened by the room around it: a pill's light is a pill.
  const [radius, setRadius] = useState(14)
  // The step whose target is on screen now: until then, all is dimmed and nothing can be pressed.
  const [foundFor, setFoundFor] = useState<number | null>(null)
  // The step whose target stays away (a page that can't show it): its bubble then shows alone, in the middle.
  const [missingFor, setMissingFor] = useState<number | null>(null)
  // On the way to the target (its step's "via").
  const [roundabout, setRoundabout] = useState(false)
  const scrolled = useRef<Element | null>(null)

  useEffect(() => {
    if (step === null) return
    const at = tourSteps[step]
    let frame = 0
    let awaySince: number | null = null
    let missingSince: number | null = null
    const light = (target: Element) => {
      if (scrolled.current !== target) {
        scrolled.current = target
        if (offScreen(target.getBoundingClientRect())) target.scrollIntoView({ block: 'center', inline: 'center' })
      }
      const next = target.getBoundingClientRect()
      setRect(previous => (sameRect(previous, next) ? previous : next))
      setRadius(Math.min(parseFloat(getComputedStyle(target).borderTopLeftRadius) || 0, next.height / 2) + HOLE_PADDING)
    }
    const follow = (time: number) => {
      if (!at || at.pick || at.center) {
        setRect(null)
        setMissingFor(at?.center ? step : null)
        frame = requestAnimationFrame(follow)
        return
      }
      awaySince = since(!at.where(), awaySince, time)
      if (awaySince !== null && time - awaySince > AWAY_MS) {
        const back = tourSteps.slice(0, step).findLastIndex(earlier => earlier.where())
        goToTourStep(Math.max(back, 0))
        return
      }
      const direct = shownTarget(at.target)
      const target = direct ?? (at.via ? shownTarget(at.via.target) : null)
      setRoundabout(!direct && target !== null)
      setFoundFor(target ? step : null)
      missingSince = since(!target, missingSince, time)
      setMissingFor(missingSince !== null && time - missingSince > MISSING_MS ? step : null)
      if (target) light(target)
      frame = requestAnimationFrame(follow)
    }
    frame = requestAnimationFrame(follow)
    return () => cancelAnimationFrame(frame)
  }, [step, tourSteps])

  return { rect, radius, foundFor, missingFor, roundabout }
}

// Once a source is added: "Ajoutée" shows a moment, then the dialog closes on its own and the tour moves on.
const onAdded = (topicId: string, next: () => void) => {
  let timer = 0
  const added = () => {
    // A topic hidden in Thèmes has no menu row: the next step, pressing it, would have nothing to light up.
    const { hiddenTopics } = getPreferences()
    if (hiddenTopics.includes(topicId))
      updatePreferences({ hiddenTopics: hiddenTopics.filter(id => id !== topicId) }, { quiet: true })
    timer = window.setTimeout(() => {
      document.querySelector<HTMLDialogElement>('dialog[open]')?.close()
      next()
    }, ADDED_PAUSE_MS)
  }
  window.addEventListener(TOPICS_CHANGED, added)
  return () => {
    window.removeEventListener(TOPICS_CHANGED, added)
    window.clearTimeout(timer)
  }
}

// A press on the target, or a source added, moves on.
export const useTourAdvance = (step: number | null, current: Step | undefined, topicId: string) => {
  useEffect(() => {
    if (step === null || !current || current.pick || current.until === 'next') return
    const next = () => goToTourStep(step + 1)
    if (current.until === 'added') return onAdded(topicId, next)
    const pressed = (event: MouseEvent) => {
      // Moves on after the click: nothing to clear.
      if (event.target instanceof Element && event.target.closest(current.target)) window.setTimeout(next)
    }
    document.addEventListener('click', pressed, true)
    return () => document.removeEventListener('click', pressed, true)
  }, [step, current, topicId])
}
