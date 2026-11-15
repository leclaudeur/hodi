import { Bookmark, EyeOff } from 'lucide-react'
import { type MouseEvent, type PointerEvent, type ReactNode, type RefObject, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TopicItem } from '../api.ts'
import { toggleSaved, useIsSaved } from './BookmarkButton.tsx'
import styles from './SwipeCard.module.css'

interface SwipeCardProps {
  item: TopicItem
  // The card is put away: the list shows its title and "Annuler" in its place.
  onDismiss: () => void
  // Slides by itself once, a little to each side, to show the swipe; onHinted when it has.
  hint?: boolean
  onHinted?: () => void
  children: ReactNode
}

// Past this, letting go acts; the card follows the finger less beyond it.
const THRESHOLD = 88
// A move this long decides between a swipe and a scroll.
const SLOP = 10
const OUT_MS = 180
// The hint: how long each way takes, how long it stays open, and when it starts. It slides just far enough
// to show the whole action, its margin on one side only ("Enregistrer" is wider than "Save").
const PEEK_MS = 650
const PEEK_HOLD_MS = 450
// Gentle at both ends: it glides out and back instead of jumping off.
const PEEK_EASE = 'cubic-bezier(0.45, 0, 0.55, 1)'
const PEEK_DELAY_MS = 900

type Side = 'save' | 'dismiss'

interface Gesture {
  pointerId: number
  x: number
  y: number
  dx: number
  // x: the card follows the finger. y: the page scrolls, the card stays.
  axis: 'x' | 'y' | null
}

const moveLayer = (element: HTMLElement | null, dx: number, animated: boolean) => {
  if (!element) return
  element.style.transition = animated ? `transform ${OUT_MS}ms ease-out` : 'none'
  element.style.transform = dx === 0 ? '' : `translateX(${dx}px)`
}

// Slides the card to show the action behind it, just far enough for the whole label.
const peekLayer = (element: HTMLElement | null, direction: -1 | 0 | 1) => {
  if (!element) return
  // The action behind shows once its side is set: measured on the next frame.
  requestAnimationFrame(() => {
    const label = element.parentElement?.querySelector<HTMLElement>(direction < 0 ? '[data-dismiss]' : '[data-save]')
    const gutter = parseFloat(getComputedStyle(element.previousElementSibling ?? element).paddingLeft) || 16
    const peek = (label?.offsetWidth ?? 80) + gutter
    element.style.transition = `transform ${PEEK_MS}ms ${PEEK_EASE}`
    element.style.transform = direction === 0 ? '' : `translateX(${direction * peek}px)`
  })
}

// Once the list has settled: to the left, "Masquer" behind; back; to the right, "Enregistrer"; back. A touch
// stops it (the function returned), and it counts as shown.
const useSwipeHint = (
  hint: boolean,
  layer: RefObject<HTMLDivElement | null>,
  setSide: (side: Side | null) => void,
  onHinted: (() => void) | undefined
) => {
  const hinting = useRef(false)
  const stopHint = useRef<() => void>(() => {})
  useEffect(() => {
    if (!hint) return
    const timers: number[] = []
    // eslint-disable-next-line @eslint-react/web-api-no-leaked-timeout -- kept in timers, cleared by the cleanup below
    const at = (ms: number, step: () => void) => timers.push(window.setTimeout(step, ms))
    const slide = (direction: -1 | 0 | 1) => peekLayer(layer.current, direction)
    const leg = PEEK_MS + PEEK_HOLD_MS
    at(PEEK_DELAY_MS, () => {
      hinting.current = true
      setSide('dismiss')
      slide(-1)
    })
    at(PEEK_DELAY_MS + leg, () => slide(0))
    at(PEEK_DELAY_MS + leg + PEEK_MS + 250, () => {
      setSide('save')
      slide(1)
    })
    at(PEEK_DELAY_MS + 2 * leg + PEEK_MS + 250, () => slide(0))
    at(PEEK_DELAY_MS + 2 * leg + 2 * PEEK_MS + 250, () => {
      hinting.current = false
      setSide(null)
      onHinted?.()
    })
    const stop = () => {
      timers.forEach(timer => window.clearTimeout(timer))
      if (hinting.current) {
        hinting.current = false
        moveLayer(layer.current, 0, true)
        setSide(null)
        onHinted?.()
      }
    }
    stopHint.current = stop
    return stop
    // eslint-disable-next-line react-hooks/exhaustive-deps -- played once per mount with hint on; onHinted is the list's, stable enough
  }, [hint])
  return stopHint
}

// Decides once the move is long enough whether it is a swipe (the card takes the finger) or a scroll; false until then.
const decideAxis = (current: Gesture, dx: number, dy: number, event: PointerEvent<HTMLDivElement>) => {
  if (current.axis !== null) return true
  if (Math.hypot(dx, dy) < SLOP) return false
  current.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y'
  if (current.axis === 'x') event.currentTarget.setPointerCapture(event.pointerId)
  return true
}

// Where the card goes: beyond the threshold it resists, like a rubber band. Null for a saved card pushed to the
// left: it only swipes to the right (to unsave it), so it cannot be put away by mistake.
const offsetOf = (dx: number, saved: boolean) => {
  if (saved && dx < 0) return null
  const distance = Math.abs(dx)
  const eased = distance <= THRESHOLD ? distance : THRESHOLD + (distance - THRESHOLD) * 0.35
  return Math.sign(dx) * eased
}

const sideOf = (offset: number | null): Side | null => {
  if (offset === null) return null
  return offset > 0 ? 'save' : 'dismiss'
}

// A swipe ends over the card's link: the click that follows must not open it.
const useClickGuard = () => {
  const swipedRef = useRef(false)
  const onClickCapture = (event: MouseEvent) => {
    if (!swipedRef.current) return
    swipedRef.current = false
    event.preventDefault()
    event.stopPropagation()
  }
  return { swipedRef, onClickCapture }
}

// The actions behind the card, shown as it slides.
const Behind = ({ saved }: { saved: boolean }) => {
  const { t } = useTranslation()
  return (
    <div className={styles.behind} aria-hidden="true">
      <span className={styles.save} data-save>
        <Bookmark size={18} fill={saved ? 'none' : 'currentColor'} />
        {saved ? t('card.unsave') : t('card.save')}
      </span>
      <span className={styles.dismiss} data-dismiss>
        {t('card.hide')}
        <EyeOff size={18} />
      </span>
    </div>
  )
}

// Swiped like a mail: to the right it is saved (or unsaved), to the left it is put away (not when saved).
// Touch only: a mouse clicks the card's buttons. Vertical moves are the page's (touch-action: pan-y).
const SwipeCard = ({ item, onDismiss, hint = false, onHinted, children }: SwipeCardProps) => {
  const saved = useIsSaved(item.id)
  const layer = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const { swipedRef, onClickCapture } = useClickGuard()
  const [side, setSide] = useState<Side | null>(null)
  const [armed, setArmed] = useState(false)
  const stopHint = useSwipeHint(hint, layer, setSide, onHinted)

  const reset = () => {
    gesture.current = null
    moveLayer(layer.current, 0, true)
    setArmed(false)
  }

  const handlePointerDown = (event: PointerEvent) => {
    if (event.pointerType === 'mouse' || !event.isPrimary) return
    stopHint.current()
    gesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, axis: null }
    swipedRef.current = false
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = gesture.current
    if (!current || current.pointerId !== event.pointerId) return
    const dx = event.clientX - current.x
    if (!decideAxis(current, dx, event.clientY - current.y, event) || current.axis !== 'x') return
    const offset = offsetOf(dx, saved)
    // A saved card pushed to the left goes back to its place, once, and nothing shows behind it.
    if (offset === null && current.dx === 0) return
    current.dx = offset ?? 0
    moveLayer(layer.current, current.dx, false)
    const nextSide = sideOf(offset)
    if (nextSide !== side) setSide(nextSide)
    const nextArmed = offset !== null && Math.abs(dx) >= THRESHOLD
    if (nextArmed === armed) return
    setArmed(nextArmed)
    // A tick when the action is ready, where the device can (not on iPhone).
    if (nextArmed) navigator.vibrate?.(8)
  }

  const handlePointerUp = (event: PointerEvent) => {
    const current = gesture.current
    if (!current || current.pointerId !== event.pointerId) return
    if (current.axis !== 'x') {
      gesture.current = null
      return
    }
    swipedRef.current = true
    if (Math.abs(current.dx) < THRESHOLD) {
      reset()
      return
    }
    if (current.dx > 0) {
      toggleSaved(item, saved)
      reset()
      return
    }
    gesture.current = null
    moveLayer(layer.current, -(layer.current?.offsetWidth ?? 400), true)
    window.setTimeout(onDismiss, OUT_MS)
  }

  return (
    <div
      className={styles.swipe}
      data-swipe
      data-side={side ?? undefined}
      data-armed={armed || undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={reset}
      onClickCapture={onClickCapture}
    >
      <Behind saved={saved} />
      <div ref={layer} className={styles.layer}>
        {children}
      </div>
    </div>
  )
}

// In the card's place while it can still be brought back.
// Where a card was put away: its title on one line, to know which one it was, and "Annuler".
export const UndoRow = ({ label, title, onUndo }: { label: string; title: string; onUndo: () => void }) => {
  const { t } = useTranslation()
  return (
    <div className={styles.undo} role="status">
      <span className={styles.undoLabel}>
        <EyeOff size={16} aria-hidden="true" />
        <span className="visually-hidden">{t('card.undoLabel', { label })}</span>
        <span className={styles.undoTitle}>{title}</span>
      </span>
      <button type="button" className={styles.undoButton} onClick={onUndo}>
        {t('common.cancel')}
      </button>
    </div>
  )
}

export default SwipeCard
