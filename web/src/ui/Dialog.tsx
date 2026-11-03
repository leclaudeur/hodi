import { ArrowLeft, X } from 'lucide-react'
import { type ReactNode, useEffect, useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { closeAllLayers, closeLayer, openLayer, useLayer } from '../lib/dialog-stack.ts'
import { typesAtOnce, useIsPhone } from '../lib/use-media.ts'
import styles from './Dialog.module.css'
import RoundButton from './RoundButton.tsx'

interface DialogProps {
  open: boolean
  // Escape, a click outside, the cross or the parent closing it.
  onClose: () => void
  // compact: little to read (a question, a short form); wide: more to read side by side.
  size?: 'compact' | 'wide'
  // With a title, a tinted header with the cross; without, the content names the dialog through labelledBy.
  title?: ReactNode
  // A page opened inside the dialog (a badge in a profile's sheet): a back arrow before the title returns from it.
  onBack?: () => void
  labelledBy?: string
  describedBy?: string
  // What the dialog is for, in a sentence or two, under the title (a RichText for its emphasis).
  intro?: ReactNode
  className?: string
  children: ReactNode
}

// What a person types into: not a switch, a choice, a file picker or a button.
const FIELD =
  'input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="range"]):not([type="file"]):not(:disabled), textarea:not(:disabled)'

// Every dialog of the app: a card over the blurred page, opened as a modal (the page behind cannot be reached).
// Opened from another dialog, it takes that one's place as the same card with new content: "Retour" (and
// Escape) goes back to it, the cross and a click outside close them all (lib/dialog-stack.ts).
const Dialog = ({
  open,
  onClose,
  size = 'compact',
  title,
  onBack,
  labelledBy,
  describedBy,
  intro,
  className = '',
  children
}: DialogProps) => {
  const { t } = useTranslation()
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const introId = useId()
  const layerId = useId()
  const { covered, hasPrevious } = useLayer(layerId)
  // The cross to the finger on a phone.
  const isPhone = useIsPhone()

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (open && !element.open) {
      element.showModal()
      openLayer({ id: layerId, close: () => element.close() })
      // Its first field takes the focus, ready to type, on a computer. Without one, or on a touch screen (see
      // typesAtOnce), the dialog itself does, not its first control: no ring on a row or a button it did not ask for.
      // Tab goes on into it.
      const field = typesAtOnce() ? element.querySelector<HTMLElement>(FIELD) : null
      if (field) field.focus()
      else element.focus()
    }
    if (!open && element.open) element.close()
    if (!open) closeLayer(layerId)
  }, [open, layerId])

  // Gone with its parent while open: no longer in the stack.
  useEffect(() => () => closeLayer(layerId), [layerId])

  // A modal dialog moved in the page (its parent re-rendered around it, as when a request arrives under an open
  // one) leaves the top layer but stays open: drawn inside the page, under what is above it. Back on top, without
  // the close event that would close it for good.
  useEffect(() => {
    const element = dialog.current
    if (!open || !element?.open || element.matches(':modal')) return
    element.removeAttribute('open')
    element.showModal()
  })

  return (
    <dialog
      ref={dialog}
      className={`${styles.dialog} ${styles[size]} ${hasPrevious ? styles.stacked : ''} ${covered ? styles.covered : ''} ${className}`}
      aria-labelledby={title ? titleId : labelledBy}
      aria-describedby={describedBy ?? (intro ? introId : undefined)}
      tabIndex={-1}
      onClose={event => {
        // React passes a dialog's close up its tree: one opened from inside this one's content closing is not this one.
        if (event.target !== dialog.current) return
        closeLayer(layerId)
        onClose()
      }}
      onClick={event => event.target === dialog.current && closeAllLayers()}
    >
      {open && title && (
        <div className={`${styles.header} ${onBack || hasPrevious ? styles.withBack : ''}`}>
          <span className={styles.lead}>
            {(onBack || hasPrevious) && (
              <RoundButton
                icon={ArrowLeft}
                label={t('common.back')}
                size={isPhone ? 44 : 34}
                onClick={onBack ?? (() => dialog.current?.close())}
              />
            )}
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
          </span>
          <RoundButton icon={X} label={t('common.close')} size={isPhone ? 44 : 34} onClick={closeAllLayers} />
        </div>
      )}
      {open && (
        <div className={styles.body}>
          {intro && (
            <p id={introId} className={styles.intro}>
              {intro}
            </p>
          )}
          {children}
        </div>
      )}
    </dialog>
  )
}

export default Dialog
