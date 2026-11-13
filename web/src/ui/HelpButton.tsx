import { CircleHelp } from 'lucide-react'
import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import Button from './Button.tsx'
import { useFloatingPanel } from '../lib/floating.ts'
import { useTranslation } from 'react-i18next'
import Dialog from './Dialog.tsx'
import DialogActions from './DialogActions.tsx'
import styles from './HelpButton.module.css'

const SEEN_KEY = 'hodi:help-seen'

const readSeen = (): string[] => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter(entry => typeof entry === 'string') : []
  } catch {
    return []
  }
}

const markSeen = (id: string) => {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...new Set([...readSeen(), id])]))
  } catch {
    // Private browsing: it shows blue again next time.
  }
}

interface HelpButtonProps {
  // The page it explains: once opened, its button turns grey on this device.
  id: string
  title: string
  // Beside the title on a computer: a bubble under the button. Elsewhere, a dialog.
  layout: 'desktop' | 'phone'
  children: ReactNode
}

// The "?" beside a page's title: how the page works, what the tour said about it. Blue until opened once.
const HelpButton = ({ id, title, layout, children }: HelpButtonProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState(() => readSeen().includes(id))
  const wrapper = useRef<HTMLSpanElement>(null)
  const bubbleId = useId()
  const { attach, style: floatingStyle } = useFloatingPanel(open && layout === 'desktop', { gap: 10, cross: -12 })

  const show = () => {
    setOpen(!open)
    if (!seen) {
      markSeen(id)
      setSeen(true)
    }
  }

  // The bubble closes on a click elsewhere or Escape.
  useEffect(() => {
    if (!open || layout !== 'desktop') return
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !wrapper.current?.contains(event.target as Node))
        setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open, layout])

  return (
    <span ref={wrapper} className={styles.wrapper} data-help>
      <button
        type="button"
        className={`${styles.button} ${seen ? styles.seen : ''}`}
        aria-label={t('common.help', { title })}
        aria-expanded={layout === 'desktop' ? open : undefined}
        aria-controls={layout === 'desktop' && open ? bubbleId : undefined}
        onClick={show}
      >
        <CircleHelp aria-hidden="true" />
      </button>
      {layout === 'desktop'
        ? open && (
            <div
              ref={attach}
              popover="manual"
              style={floatingStyle}
              id={bubbleId}
              className={styles.bubble}
              role="dialog"
              aria-label={title}
            >
              <strong className={styles.title}>{title}</strong>
              <div className={styles.text}>{children}</div>
            </div>
          )
        : open && (
            <Dialog open onClose={() => setOpen(false)} title={title} className={styles.dialog}>
              <div className={styles.text}>{children}</div>
              <DialogActions>
                <Button look="primary" onClick={() => setOpen(false)}>
                  {t('common.gotIt')}
                </Button>
              </DialogActions>
            </Dialog>
          )}
    </span>
  )
}

export default HelpButton
