import { Bookmark, EyeOff } from 'lucide-react'
import { type MouseEvent, type PointerEvent, type ReactNode, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TopicItem } from '../api.ts'
import { toggleSaved, useIsSaved } from './BookmarkButton.tsx'
import styles from './SwipeCard.module.css'

interface SwipeCardProps {
  item: TopicItem
  // The card is put away: the list shows its title and "Annuler" in its place.
  onDismiss: () => void
  children: ReactNode
}

// Past this, letting go acts; the card follows the finger less beyond it.
const THRESHOLD = 88
// A move this long decides between a swipe and a scroll.
const SLOP = 10
const OUT_MS = 180

type Side = 'save' | 'dismiss'

interface Gesture {
  pointerId: number
  x: number
  y: number
  dx: number
  // x: the card follows the finger. y: the page scrolls, the card stays.
  axis: 'x' | 'y' | null
}

// Swiped like a mail: to the right it is saved (or unsaved), to the left it is put away (not when saved).
// Touch only: a mouse clicks the card's buttons. Vertical moves are the page's (touch-action: pan-y).
const SwipeCard = ({ item, onDismiss, children }: SwipeCardProps) => {
  const { t } = useTranslation()
  const saved = useIsSaved(item.id)
  const layer = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  // A swipe ends over the card's link: the click that follows must not open it.
  const swiped = useRef(false)
  const [side, setSide] = useState<Side | null>(null)
  const [armed, setArmed] = useState(false)

  const moveTo = (dx: number, animated: boolean) => {
    const element = layer.current
    if (!element) return
    element.style.transition = animated ? `transform ${OUT_MS}ms ease-out` : 'none'
    element.style.transform = dx === 0 ? '' : `translateX(${dx}px)`
  }

  const reset = () => {
    gesture.current = null
    moveTo(0, true)
    setArmed(false)
  }

  const handlePointerDown = (event: PointerEvent) => {
    if (event.pointerType === 'mouse' || !event.isPrimary) return
    gesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, axis: null }
    swiped.current = false
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = gesture.current
    if (!current || current.pointerId !== event.pointerId) return

    const dx = event.clientX - current.x
    const dy = event.clientY - current.y
    if (current.axis === null) {
      if (Math.hypot(dx, dy) < SLOP) return
      current.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y'
      if (current.axis === 'y') return
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    if (current.axis !== 'x') return
    // A saved card only swipes to the right (to unsave it): it cannot be put away by mistake.
    if (saved && dx < 0) {
      if (current.dx !== 0) {
        current.dx = 0
        moveTo(0, false)
        setSide(null)
        setArmed(false)
      }
      return
    }

    // Beyond the threshold the card resists, like a rubber band.
    const distance = Math.abs(dx)
    const eased = distance <= THRESHOLD ? distance : THRESHOLD + (distance - THRESHOLD) * 0.35
    current.dx = Math.sign(dx) * eased
    moveTo(current.dx, false)

    const nextSide = dx > 0 ? 'save' : 'dismiss'
    if (nextSide !== side) setSide(nextSide)
    const nextArmed = distance >= THRESHOLD
    if (nextArmed !== armed) {
      setArmed(nextArmed)
      // A tick when the action is ready, where the device can (not on iPhone).
      if (nextArmed) navigator.vibrate?.(8)
    }
  }

  const handlePointerUp = (event: PointerEvent) => {
    const current = gesture.current
    if (!current || current.pointerId !== event.pointerId) return
    if (current.axis !== 'x') {
      gesture.current = null
      return
    }

    swiped.current = true
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
    moveTo(-(layer.current?.offsetWidth ?? 400), true)
    window.setTimeout(onDismiss, OUT_MS)
  }

  const handleClickCapture = (event: MouseEvent) => {
    if (!swiped.current) return
    swiped.current = false
    event.preventDefault()
    event.stopPropagation()
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
      onClickCapture={handleClickCapture}
    >
      <div className={styles.behind} aria-hidden="true">
        <span className={styles.save}>
          <Bookmark size={18} fill={saved ? 'none' : 'currentColor'} />
          {saved ? t('card.unsave') : t('card.save')}
        </span>
        <span className={styles.dismiss}>
          {t('card.hide')}
          <EyeOff size={18} />
        </span>
      </div>
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
