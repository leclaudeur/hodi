import { type CSSProperties, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { TOPICS_CHANGED, type TopicSummary } from '../api.ts'
import { useHouseholdGame } from '../lib/game.ts'
import { t } from '../lib/i18n.ts'
import { getPreferences, updatePreferences } from '../lib/preferences.ts'
import { takeTour, useCurrentProfile } from '../lib/profiles.ts'
import { endTour, goToTourStep, startTour, useTourStep } from '../lib/tour.ts'
import { topicHref } from '../lib/use-hash-route.ts'
import Button from '../ui/Button.tsx'
import Confetti from '../ui/Confetti.tsx'
import styles from './Tour.module.css'
import TourPicker from './TourPicker.tsx'

// The guided tour, as in games: everything dims but the one thing to press, a bubble says what it does, a counter
// and "Passer" go with it. It starts on the topics to pick, then adds a source for the first one picked, step by step,
// opens that topic and ends there on confetti. With the household game on, it then opens the profile's sheet and
// ends there, the sheet left open under the confetti.

interface Step {
  // The first screen: topics to pick, in the middle (no target).
  pick?: boolean
  // Nothing to light up: the bubble alone, in the middle, with its "Suivant".
  center?: boolean
  // What to press: the first one shown on screen.
  target: string
  title: string
  // One sentence per line, one action per sentence.
  text: string[]
  // When the target is not on this screen (a phone's settings have no topics): the way to it, and what to say.
  via?: { target: string; text: string[] }
  // Where the step makes sense: away from it (the dialog closed, another page), the tour steps back to the last
  // step that does.
  where: () => boolean
  // The step ends on a press of its target, once a source is added (the dialog then closes by itself), or on its own
  // "Compris" (nothing to press: only something to look at).
  until: 'press' | 'added' | 'next'
  // "Suivant" closes the dialog the step sits in, so the next step's target can be pressed.
  closeDialog?: boolean
}

const on = (prefix: string) => () => window.location.hash.startsWith(prefix)
const inDialog = () => document.querySelector('dialog[open] [data-tour="add-way"]') !== null
const inSheet = () => document.querySelector('dialog[open] [data-tour="level"]') !== null

// The game's two steps: the header's avatar, then the level in the sheet it opens.
const gameSteps = (): Step[] => [
  {
    target: '[data-tour="profile"]',
    title: t('tour.profile.title'),
    text: [t('tour.profile.points'), t('tour.profile.open')],
    via: {
      target: 'a[href="#/"]',
      text: [t('tour.profile.points'), t('tour.profile.via')]
    },
    where: () => true,
    until: 'press'
  },
  {
    target: 'dialog[open] [data-tour="level"]',
    title: t('tour.level.title'),
    text: [t('tour.level.grades'), t('tour.level.badges'), t('tour.level.wear')],
    where: inSheet,
    until: 'next'
  }
]

// The tour's topic: the first one picked (Sport until then). Built again when the language changes.
const steps = ({ id, label }: TopicSummary, game: boolean): Step[] => [
  {
    pick: true,
    target: '',
    title: t('tour.welcome.title'),
    text: [t('tour.welcome.ask'), t('tour.welcome.pick')],
    where: () => true,
    until: 'press'
  },
  {
    target: 'a[href="#/reglages"]',
    title: t('tour.first.title'),
    text: [t('tour.first.together', { topic: label }), t('tour.first.settings')],
    where: () => true,
    until: 'press'
  },
  {
    target: 'a[href="#/reglages/sources"]',
    title: t('tour.sources.title'),
    text: [t('tour.sources.what'), t('tour.sources.open')],
    where: on('#/reglages'),
    until: 'press'
  },
  {
    target: '[data-tour="add-source"]',
    title: t('tour.add.title'),
    text: [t('tour.add.how'), t('tour.add.press')],
    where: on('#/reglages/sources'),
    until: 'press'
  },
  {
    target: '[data-tour="add-way"] [role="radio"]:last-child',
    title: t('tour.byTopic.title'),
    text: [t('tour.byTopic.noLink'), t('tour.byTopic.offers'), t('tour.byTopic.pick')],
    where: inDialog,
    until: 'press'
  },
  {
    target: `[data-tour="add-topics"] [data-topic="${id}"]`,
    title: label,
    text: [t('tour.topic.suggestions'), t('tour.topic.pick', { topic: label })],
    where: inDialog,
    until: 'press'
  },
  {
    target: '[data-tour="add-sites"]',
    title: t('tour.site.title'),
    text: [t('tour.site.feed'), t('tour.site.add')],
    where: inDialog,
    until: 'added'
  },
  {
    target: `a[href="${topicHref(id)}"]`,
    title: t('tour.direction.title', { topic: label }),
    text: [t('tour.direction.filed', { topic: label }), t('tour.direction.open')],
    via: {
      target: 'a[href="#/"]',
      text: [t('tour.direction.filed', { topic: label }), t('tour.direction.via')]
    },
    where: () => true,
    until: 'press'
  },
  ...(game ? gameSteps() : [])
]

// A teen's tour: its parents chose its sources, so it adds none. Its feed, how to ask for a source, its profile,
// then the end. A child's will be its own, with its own interface.
const teenSteps = (game: boolean): Step[] => [
  {
    center: true,
    target: '',
    title: t('tour.teen.welcome.title'),
    text: [t('tour.teen.welcome.yours'), t('tour.teen.welcome.how')],
    where: () => true,
    until: 'next'
  },
  {
    target: '[data-tour="feed"]',
    title: t('tour.teen.feed.title'),
    text: [t('tour.teen.feed.chosen'), t('tour.teen.feed.open')],
    where: () => true,
    until: 'press'
  },
  {
    target: 'a[href="#/reglages"]',
    title: t('tour.teen.ask.title'),
    text: [t('tour.teen.ask.missing'), t('tour.teen.ask.settings')],
    where: () => true,
    until: 'press'
  },
  {
    target: 'a[href="#/reglages/sources"]',
    title: t('tour.teen.ask.title'),
    text: [t('tour.teen.ask.sources')],
    where: on('#/reglages'),
    until: 'press'
  },
  {
    target: '[data-tour="ask-source"]',
    title: t('tour.teen.ask.title'),
    text: [t('tour.teen.ask.press')],
    // On a computer, the "ask" card is in the closed "Mes demandes".
    via: { target: '[data-tour="requests"]', text: [t('tour.teen.ask.requests')] },
    where: on('#/reglages/sources'),
    until: 'press'
  },
  {
    // Inside the dialog it opened: the field for the link, with its icon.
    target: ':has(> [data-tour="ask-link"])',
    title: t('tour.teen.ask.title'),
    text: [t('tour.teen.ask.paste'), t('tour.teen.ask.parents')],
    where: on('#/reglages/sources'),
    until: 'next',
    closeDialog: true
  },
  ...(game ? gameSteps() : []),
  {
    center: true,
    target: '',
    title: t('tour.teen.end.title'),
    text: [t('tour.teen.end.enjoy')],
    where: () => true,
    until: 'next'
  }
]

const SPORT: TopicSummary = { id: 'sport', label: 'Sport' }

// Room around what to press, and between it and the bubble.
const HOLE_PADDING = 6
const GAP = 12
const MARGIN = 16
// A page or a dialog takes a moment to open: the tour steps back only once it stays away.
const AWAY_MS = 500
const ADDED_PAUSE_MS = 900
// Long enough for the last confetti to fall: 2.6 s, after the longest delay (15 × 45 ms).
const CHEER_MS = 3400
// A target that hasn't come after this long won't: the bubble shows anyway, with "Passer".
const MISSING_MS = 1200

const shownTarget = (selector: string) =>
  [...document.querySelectorAll(selector)].find(element => {
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }) ?? null

const sameRect = (a: DOMRect | null, b: DOMRect | null) =>
  a === b || (!!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height)

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

const Lines = ({ text }: { text: string[] }) =>
  text.map(line => (
    <span key={line} className={styles.line}>
      {line}
    </span>
  ))

// Progress as segments, as in the stories: done and now in the accent.
const Bars = ({ count, step }: { count: number; step: number }) => (
  <div className={styles.bars} aria-hidden="true">
    {Array.from({ length: count }, (_, index) => (
      <i key={index} className={index <= step ? styles.done : undefined} />
    ))}
  </div>
)

const Tour = () => {
  // The steps' texts follow the interface language.
  const { i18n } = useTranslation()
  const step = useTourStep()
  const profile = useCurrentProfile()
  const game = useHouseholdGame() !== null
  // The confetti after the game's last step, over the sheet left open.
  const [cheering, setCheering] = useState(false)
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

  // Follows what to press as pages open, lists load and things scroll; steps back when its place is left.
  const scrolled = useRef<Element | null>(null)
  useEffect(() => {
    if (step === null) return
    const at = tourSteps[step]
    let frame = 0
    let awaySince: number | null = null
    let missingSince: number | null = null
    const follow = (time: number) => {
      if (!at || at.pick || at.center) {
        setRect(null)
        setMissingFor(at?.center ? step : null)
        frame = requestAnimationFrame(follow)
        return
      }
      if (at.where()) awaySince = null
      else if (awaySince === null) awaySince = time
      else if (time - awaySince > AWAY_MS) {
        const back = tourSteps.slice(0, step).findLastIndex(earlier => earlier.where())
        goToTourStep(Math.max(back, 0))
        return
      }
      const direct = shownTarget(at.target)
      const target = direct ?? (at.via ? shownTarget(at.via.target) : null)
      setRoundabout(!direct && target !== null)
      if (target && scrolled.current !== target) {
        scrolled.current = target
        const box = target.getBoundingClientRect()
        // Out of the screen, or of a row that scrolls sideways (a phone's topics).
        if (box.top < 0 || box.bottom > window.innerHeight || box.left < 0 || box.right > window.innerWidth)
          target.scrollIntoView({ block: 'center', inline: 'center' })
      }
      setFoundFor(target ? step : null)
      if (target) missingSince = null
      else if (missingSince === null) missingSince = time
      setMissingFor(missingSince !== null && time - missingSince > MISSING_MS ? step : null)
      if (target) {
        const next = target.getBoundingClientRect()
        setRect(previous => (sameRect(previous, next) ? previous : next))
        setRadius(
          Math.min(parseFloat(getComputedStyle(target).borderTopLeftRadius) || 0, next.height / 2) + HOLE_PADDING
        )
      }
      frame = requestAnimationFrame(follow)
    }
    frame = requestAnimationFrame(follow)
    return () => cancelAnimationFrame(frame)
  }, [step, tourSteps])

  useEffect(() => {
    if (!cheering) return
    const timer = window.setTimeout(() => setCheering(false), CHEER_MS)
    return () => window.clearTimeout(timer)
  }, [cheering])

  // A press on the target, or a source added, moves on.
  useEffect(() => {
    if (step === null || !current || current.pick || current.until === 'next') return
    const next = () => goToTourStep(step + 1)
    if (current.until === 'added') {
      // "Ajoutée" shows a moment, then the dialog closes on its own.
      let timer = 0
      const added = () => {
        // A topic hidden in Thèmes has no menu row: the next step, pressing it, would have nothing to light up.
        const { hiddenTopics } = getPreferences()
        if (hiddenTopics.includes(focus.topic.id))
          updatePreferences({ hiddenTopics: hiddenTopics.filter(id => id !== focus.topic.id) }, { quiet: true })
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
    const pressed = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest(current.target)) window.setTimeout(next)
    }
    document.addEventListener('click', pressed, true)
    return () => document.removeEventListener('click', pressed, true)
  }, [step, current, focus.topic.id])

  if (!host) return null
  if (step === null) return cheering ? createPortal(<Confetti />, host) : null

  // The end, over the topic and its new source.
  if (!current) {
    const finish = () => {
      document.querySelector<HTMLDialogElement>('dialog[open]')?.close()
      endTour()
    }
    return createPortal(
      <div className={styles.layer}>
        <div className={`${styles.dim} ${styles.soft}`} />
        <Confetti />
        <div className={`${styles.bubble} ${styles.end}`} role="dialog" aria-labelledby="tour-title">
          <div className={styles.head}>
            <h2 id="tour-title" className={styles.title}>
              {t('tour.end.title')}
            </h2>
          </div>
          <p className={styles.text}>
            <Lines
              text={[
                t('tour.end.here', { topic: focus.topic.label }),
                focus.added > 0 ? t('tour.end.others') : t('tour.end.feed'),
                t('tour.end.enjoy')
              ]}
            />
          </p>
          <div className={styles.foot}>
            <Button look="primary" onClick={finish}>
              {t('tour.end.go')}
            </Button>
          </div>
        </div>
      </div>,
      host
    )
  }

  // The topics to pick, in the middle of the dimmed screen.
  if (current.pick)
    return createPortal(
      <div className={styles.layer}>
        <div className={`${styles.pane} ${styles.dim}`} />
        <div
          className={`${styles.bubble} ${styles.end} ${styles.wide}`}
          role="dialog"
          aria-labelledby="tour-title"
          aria-describedby="tour-text"
        >
          <div className={styles.head}>
            <Bars count={tourSteps.length} step={step} />
            <h2 id="tour-title" className={styles.title}>
              {current.title}
            </h2>
          </div>
          <p id="tour-text" className={styles.text}>
            <Lines text={current.text} />
          </p>
          <TourPicker
            onDone={(topic, added) => {
              setFocus({ topic, added })
              goToTourStep(step + 1)
            }}
            onSkip={endTour}
          />
        </div>
      </div>,
      host
    )

  const hole = foundFor === step &&
    rect && {
      borderRadius: radius,
      top: rect.top - HOLE_PADDING,
      left: rect.left - HOLE_PADDING,
      width: rect.width + HOLE_PADDING * 2,
      height: rect.height + HOLE_PADDING * 2
    }
  // Under what to press when there is room, else above it; never past the screen's sides.
  const width = Math.min(340, window.innerWidth - MARGIN * 2)
  const below = !hole || hole.top + hole.height + GAP + 180 < window.innerHeight
  const left = hole
    ? Math.min(Math.max(hole.left + hole.width / 2 - width / 2, MARGIN), window.innerWidth - width - MARGIN)
    : 0
  // The bubble's tip, under or over the middle of what to press.
  const tip = hole ? Math.min(Math.max(hole.left + hole.width / 2 - left, 24), width - 24) : 0
  const bubble = (
    hole
      ? {
          width,
          left,
          '--tip': `${tip}px`,
          ...(below ? { top: hole.top + hole.height + GAP } : { top: hole.top - GAP, translate: '0 -100%' })
        }
      : { width }
  ) as CSSProperties

  return createPortal(
    <div className={styles.layer}>
      {hole ? (
        <>
          {/* Four panes around the hole keep presses on the target only. */}
          <div className={styles.pane} style={{ top: 0, left: 0, right: 0, height: Math.max(hole.top, 0) }} />
          <div className={styles.pane} style={{ top: hole.top + hole.height, left: 0, right: 0, bottom: 0 }} />
          <div
            className={styles.pane}
            style={{ top: hole.top, left: 0, width: Math.max(hole.left, 0), height: hole.height }}
          />
          <div
            className={styles.pane}
            style={{ top: hole.top, left: hole.left + hole.width, right: 0, height: hole.height }}
          />
          <div className={styles.hole} style={hole} />
        </>
      ) : (
        <div className={`${styles.pane} ${styles.dim}`} />
      )}
      {(hole || missingFor === step) && (
        <div
          className={`${styles.bubble} ${hole ? (below ? styles.below : styles.above) : styles.end}`}
          style={bubble}
          role="dialog"
          aria-labelledby="tour-title"
          aria-describedby="tour-text"
        >
          <div className={styles.head}>
            <Bars count={tourSteps.length} step={step} />
            <h2 id="tour-title" className={styles.title}>
              {current.title}
            </h2>
          </div>
          <p id="tour-text" className={styles.text}>
            <Lines text={roundabout && current.via ? current.via.text : current.text} />
          </p>
          {current.until === 'next' ? (
            <div className={styles.foot}>
              {step < tourSteps.length - 1 ? (
                // "Passer" on every step but the last, as on the steps to press.
                <>
                  <Button onClick={endTour}>{t('tour.skip')}</Button>
                  <span className={styles.ahead}>
                    <span className={styles.count}>
                      {step + 1} / {tourSteps.length}
                    </span>
                    <Button
                      look="primary"
                      onClick={() => {
                        if (current.closeDialog) document.querySelector<HTMLDialogElement>('dialog[open]')?.close()
                        goToTourStep(step + 1)
                      }}
                    >
                      {t('tour.next')}
                    </Button>
                  </span>
                </>
              ) : (
                <>
                  <span className={styles.count}>
                    {step + 1} / {tourSteps.length}
                  </span>
                  <Button
                    look="primary"
                    onClick={() => {
                      setCheering(true)
                      endTour()
                    }}
                  >
                    {teen ? t('tour.teen.end.go') : t('common.gotIt')}
                  </Button>
                </>
              )}
            </div>
          ) : (
            <div className={styles.foot}>
              <Button onClick={endTour}>{t('tour.skip')}</Button>
              <span className={styles.count}>
                {step + 1} / {tourSteps.length}
              </span>
            </div>
          )}
        </div>
      )}
    </div>,
    host
  )
}

export default Tour
