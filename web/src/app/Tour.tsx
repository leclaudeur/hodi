import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { TopicSummary } from '../api.ts'
import { useHouseholdGame } from '../lib/game.ts'
import { takeTour, useCurrentProfile } from '../lib/profiles.ts'
import { goToTourStep, startTour, useTourStep } from '../lib/tour.ts'
import Confetti from '../ui/Confetti.tsx'
import styles from './Tour.module.css'
import { EndBubble, type Hole, Panes, PickBubble, StepBubble } from './TourBubbles.tsx'
import { SPORT, steps, teenSteps } from './tour-steps.ts'
import { HOLE_PADDING, useFollowTarget, useTourAdvance } from './use-tour.ts'

// The guided tour, as in games: everything dims but the one thing to press, a bubble says what it does, a counter
// and "Passer" go with it. It starts on the topics to pick, then adds a source for the first one picked, step by step,
// opens that topic and ends there on confetti. With the household game on, it then opens the profile's sheet and
// ends there, the sheet left open under the confetti.

// Long enough for the last confetti to fall: 2.6 s, after the longest delay (15 × 45 ms).
const CHEER_MS = 3400

// Over an open dialog, the tour goes inside it: the page behind a modal dialog can't be pressed.
const hostOf = () => document.querySelector('dialog[open]') ?? document.body

// Watched only while the tour runs. React redraws before the screen is painted, so the tour never shows under a
// dialog that just opened, even for a frame.
const watchDialogs = (onChange: () => void) => {
  const observer = new MutationObserver(onChange)
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] })
  return () => observer.disconnect()
}
const watchNothing = () => () => {}

// The tour's own effects on the page: dialogs at once while it runs, and its start for a profile just added.
const useTourPage = (step: number | null) => {
  const profile = useCurrentProfile()
  // While it runs, dialogs open and close at once (base.css): the tour never sits in a dialog still fading in.
  useEffect(() => {
    if (step === null) return
    document.documentElement.toggleAttribute('data-touring', true)
    return () => {
      document.documentElement.toggleAttribute('data-touring', false)
    }
  }, [step])

  // A profile just added opens on its tour, once, wherever it is first opened. A teen has its own; a child will have
  // one in its own interface.
  useEffect(() => {
    if (!profile?.tourPending || profile.kind === 'child') return
    takeTour(profile)
    startTour()
  }, [profile])
  return profile
}

// The confetti after the game's last step, over the sheet left open.
const useCheering = () => {
  const [cheering, setCheering] = useState(false)
  useEffect(() => {
    if (!cheering) return
    const timer = window.setTimeout(() => setCheering(false), CHEER_MS)
    return () => window.clearTimeout(timer)
  }, [cheering])
  return [cheering, () => setCheering(true)] as const
}

const holeOf = (rect: DOMRect | null, radius: number): Hole | null =>
  rect && {
    borderRadius: radius,
    top: rect.top - HOLE_PADDING,
    left: rect.left - HOLE_PADDING,
    width: rect.width + HOLE_PADDING * 2,
    height: rect.height + HOLE_PADDING * 2
  }

const Tour = () => {
  // The steps' texts follow the interface language.
  const { i18n } = useTranslation()
  const step = useTourStep()
  const profile = useTourPage(step)
  const game = useHouseholdGame() !== null
  const [cheering, cheer] = useCheering()
  const host = useSyncExternalStore(step !== null ? watchDialogs : watchNothing, hostOf)
  // The topic picked first, and how many sources the others got.
  const [focus, setFocus] = useState<{ topic: TopicSummary; added: number }>({ topic: SPORT, added: 0 })
  const teen = profile?.kind === 'teen'
  const tourSteps = useMemo(
    () => (teen ? teenSteps(game) : steps(focus.topic, game)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the language changes the texts the steps read
    [teen, focus.topic, game, i18n.language]
  )
  const current = step !== null ? tourSteps[step] : undefined
  const { rect, radius, foundFor, missingFor, roundabout } = useFollowTarget(step, tourSteps)
  useTourAdvance(step, current, focus.topic.id)

  if (!host) return null
  if (step === null) return cheering ? createPortal(<Confetti />, host) : null
  if (!current) return createPortal(<EndBubble focus={focus} />, host)
  if (current.pick) {
    const picked = (topic: TopicSummary, added: number) => {
      setFocus({ topic, added })
      goToTourStep(step + 1)
    }
    return createPortal(<PickBubble current={current} step={step} count={tourSteps.length} onPicked={picked} />, host)
  }

  const hole = foundFor === step ? holeOf(rect, radius) : null
  return createPortal(
    <div className={styles.layer}>
      {hole ? <Panes hole={hole} /> : <div className={`${styles.pane} ${styles.dim}`} />}
      {(hole || missingFor === step) && (
        <StepBubble
          hole={hole}
          roundabout={roundabout}
          current={current}
          step={step}
          count={tourSteps.length}
          teen={teen}
          onCheer={cheer}
        />
      )}
    </div>,
    host
  )
}

export default Tour
