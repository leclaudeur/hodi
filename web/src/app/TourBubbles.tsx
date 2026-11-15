import type { CSSProperties } from 'react'
import type { TopicSummary } from '../api.ts'
import { t } from '../lib/i18n.ts'
import { endTour, goToTourStep } from '../lib/tour.ts'
import Button from '../ui/Button.tsx'
import Confetti from '../ui/Confetti.tsx'
import styles from './Tour.module.css'
import TourPicker from './TourPicker.tsx'
import type { Step } from './tour-steps.ts'

// Room between what to press and the bubble, and along the screen's sides.
const GAP = 12
const MARGIN = 16

export interface Hole {
  borderRadius: number
  top: number
  left: number
  width: number
  height: number
}

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

const closeDialog = () => document.querySelector<HTMLDialogElement>('dialog[open]')?.close()

// The end, over the topic and its new source.
export const EndBubble = ({ focus }: { focus: { topic: TopicSummary; added: number } }) => {
  const finish = () => {
    closeDialog()
    endTour()
  }
  return (
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
    </div>
  )
}

interface PickProps {
  current: Step
  step: number
  count: number
  onPicked: (topic: TopicSummary, added: number) => void
}

// The topics to pick, in the middle of the dimmed screen.
export const PickBubble = ({ current, step, count, onPicked }: PickProps) => (
  <div className={styles.layer}>
    <div className={`${styles.pane} ${styles.dim}`} />
    <div
      className={`${styles.bubble} ${styles.end} ${styles.wide}`}
      role="dialog"
      aria-labelledby="tour-title"
      aria-describedby="tour-text"
    >
      <div className={styles.head}>
        <Bars count={count} step={step} />
        <h2 id="tour-title" className={styles.title}>
          {current.title}
        </h2>
      </div>
      <p id="tour-text" className={styles.text}>
        <Lines text={current.text} />
      </p>
      <TourPicker onDone={onPicked} onSkip={endTour} />
    </div>
  </div>
)

// Four panes around the hole keep presses on the target only.
export const Panes = ({ hole }: { hole: Hole }) => (
  <>
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
)

// Under what to press when there is room, else above it; never past the screen's sides.
const placeBubble = (hole: Hole | null) => {
  const width = Math.min(340, window.innerWidth - MARGIN * 2)
  if (!hole) return { side: styles.end, style: { width } as CSSProperties }
  const below = hole.top + hole.height + GAP + 180 < window.innerHeight
  const left = Math.min(Math.max(hole.left + hole.width / 2 - width / 2, MARGIN), window.innerWidth - width - MARGIN)
  // The bubble's tip, under or over the middle of what to press.
  const tip = Math.min(Math.max(hole.left + hole.width / 2 - left, 24), width - 24)
  const style = {
    width,
    left,
    '--tip': `${tip}px`,
    ...(below ? { top: hole.top + hole.height + GAP } : { top: hole.top - GAP, translate: '0 -100%' })
  } as CSSProperties & { '--tip': string }
  return { side: below ? styles.below : styles.above, style }
}

interface FootProps {
  current: Step
  step: number
  count: number
  teen: boolean
  onCheer: () => void
}

// "Passer" and the counter; a step to look at has its "Suivant", the last one its own end.
const Foot = ({ current, step, count, teen, onCheer }: FootProps) => {
  const counter = (
    <span className={styles.count}>
      {step + 1} / {count}
    </span>
  )
  if (current.until !== 'next') {
    return (
      <div className={styles.foot}>
        <Button onClick={endTour}>{t('tour.skip')}</Button>
        {counter}
      </div>
    )
  }
  if (step === count - 1) {
    return (
      <div className={styles.foot}>
        {counter}
        <Button
          look="primary"
          onClick={() => {
            onCheer()
            endTour()
          }}
        >
          {teen ? t('tour.teen.end.go') : t('common.gotIt')}
        </Button>
      </div>
    )
  }
  // "Passer" on every step but the last, as on the steps to press.
  return (
    <div className={styles.foot}>
      <Button onClick={endTour}>{t('tour.skip')}</Button>
      <span className={styles.ahead}>
        {counter}
        <Button
          look="primary"
          onClick={() => {
            if (current.closeDialog) closeDialog()
            goToTourStep(step + 1)
          }}
        >
          {t('tour.next')}
        </Button>
      </span>
    </div>
  )
}

interface StepBubbleProps extends FootProps {
  hole: Hole | null
  roundabout: boolean
}

// A step's bubble beside what to press, or alone in the middle when it stays away.
export const StepBubble = ({ hole, roundabout, ...foot }: StepBubbleProps) => {
  const { current, step, count } = foot
  const { side, style } = placeBubble(hole)
  return (
    <div
      className={`${styles.bubble} ${side}`}
      style={style}
      role="dialog"
      aria-labelledby="tour-title"
      aria-describedby="tour-text"
    >
      <div className={styles.head}>
        <Bars count={count} step={step} />
        <h2 id="tour-title" className={styles.title}>
          {current.title}
        </h2>
      </div>
      <p id="tour-text" className={styles.text}>
        <Lines text={roundabout && current.via ? current.via.text : current.text} />
      </p>
      <Foot {...foot} />
    </div>
  )
}
