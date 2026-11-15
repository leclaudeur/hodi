import { Minus, Plus } from 'lucide-react'
import { type MouseEvent, type PointerEvent, type ReactNode, useEffect, useRef } from 'react'
import RoundButton from './RoundButton.tsx'
import styles from './Stepper.module.css'

interface StepperProps {
  // The whole control's name, and its buttons'.
  label: string
  lessLabel: string
  moreLabel: string
  value: number
  min: number
  max: number
  step: number
  // Bigger steps, in order, as a quick run of clicks or a long press goes on: 5 min, then 15, then 30. Each lands on
  // its own multiples, so the values stay round.
  fastSteps?: readonly number[]
  // How the value reads: "1 h 30", "10".
  children: ReactNode
  onChange: (value: number) => void
}

// Clicks closer than this make one quick run.
const QUICK_MS = 400
// A press held this long starts repeating, every REPEAT_MS.
const HOLD_MS = 400
const REPEAT_MS = 150
// Moves at each size before the next bigger step.
const MOVES_PER_STEP = 4

// A number picked by steps: its value in the middle, a round − and + on each side, in a pill as tall as the app's
// other controls. Clicking quickly or holding a button speeds it up.
const Stepper = ({
  label,
  lessLabel,
  moreLabel,
  value,
  min,
  max,
  step,
  fastSteps = [],
  children,
  onChange
}: StepperProps) => {
  // The latest value: a held button moves several times before the parent renders again.
  const current = useRef(value)
  useEffect(() => {
    current.current = value
  }, [value])
  const run = useRef({ at: 0, count: 0, direction: 0 })
  const timer = useRef<number | undefined>(undefined)

  const stop = () => {
    window.clearTimeout(timer.current)
    window.clearInterval(timer.current)
    timer.current = undefined
  }
  useEffect(() => stop, [])

  // One move at `now` (an event's time stamp); false once it reached the end.
  const move = (direction: 1 | -1, now: number) => {
    const quick = now - run.current.at < QUICK_MS && run.current.direction === direction
    run.current = { at: now, count: quick ? run.current.count + 1 : 1, direction }
    const sizes = [step, ...fastSteps]
    const size = sizes[Math.min(sizes.length - 1, Math.floor((run.current.count - 1) / MOVES_PER_STEP))] ?? step
    const from = current.current
    const next = direction > 0 ? (Math.floor(from / size) + 1) * size : (Math.ceil(from / size) - 1) * size
    const clamped = Math.min(max, Math.max(min, next))
    current.current = clamped
    onChange(clamped)
    return clamped > min && clamped < max
  }

  // Mouse or finger: one move at once, then repeated while held.
  const press = (event: PointerEvent<HTMLButtonElement>, direction: 1 | -1) => {
    if (event.button !== 0) return
    stop()
    if (!move(direction, event.timeStamp)) return
    timer.current = window.setTimeout(() => {
      timer.current = window.setInterval(() => {
        // A held press is one quick run: each repeat counts as following the last move at once.
        if (!move(direction, run.current.at)) stop()
      }, REPEAT_MS)
    }, HOLD_MS)
  }

  // The keyboard's Enter or Space: a click with no pointer press behind it.
  const click = (event: MouseEvent<HTMLButtonElement>, direction: 1 | -1) => {
    if (event.detail === 0) move(direction, event.timeStamp)
  }

  const button = (direction: 1 | -1) => (
    <RoundButton
      icon={direction > 0 ? Plus : Minus}
      label={direction > 0 ? moreLabel : lessLabel}
      size={34}
      disabled={direction > 0 ? value >= max : value <= min}
      onPointerDown={event => press(event, direction)}
      onPointerUp={() => stop()}
      onPointerLeave={() => stop()}
      onPointerCancel={() => stop()}
      onClick={event => click(event, direction)}
      onContextMenu={event => event.preventDefault()}
    />
  )

  return (
    <div className={styles.stepper} role="group" aria-label={label}>
      {button(-1)}
      <output className={styles.value} aria-live="polite">
        {children}
      </output>
      {button(1)}
    </div>
  )
}

export default Stepper
