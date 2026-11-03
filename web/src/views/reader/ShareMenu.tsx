import { Share } from 'lucide-react'
import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { loadShareOptions } from '../../lib/deferred.ts'
import { useMedia } from '../../lib/use-media.ts'
import Dialog from '../../ui/Dialog.tsx'
import RoundButton from '../../ui/RoundButton.tsx'
import styles from './ShareMenu.module.css'
import RichText from '../../ui/RichText.tsx'

interface ShareMenuProps {
  // Always the article's own link on its site, never a Hodi link.
  url: string
  title: string
  // What is shared, for the sheet's heading.
  kind?: 'article' | 'video' | 'podcast'
  size?: 34 | 44
  variant?: 'default' | 'glass'
}

const ShareOptions = lazy(loadShareOptions)

// Share the original article: by e-mail, WhatsApp, Messenger (phones), or its link copied.
const ShareMenu = ({ url, title, kind = 'article', size = 34, variant = 'default' }: ShareMenuProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const menu = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const phone = useMedia('(pointer: coarse)')

  // The menu under the button closes on a click outside or Escape (the phone's dialog on its own).
  useEffect(() => {
    if (!open || phone) return
    const handlePointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (!menu.current?.contains(target) && !panel.current?.contains(target)) setOpen(false)
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', handlePointer)
    document.addEventListener('keydown', handleKey, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointer)
      document.removeEventListener('keydown', handleKey, true)
    }
  }, [open, phone])

  const heading = t(`shareMenu.heading.${kind}`)
  const options = (
    <Suspense>
      <ShareOptions url={url} title={title} phone={phone} />
    </Suspense>
  )

  return (
    <div ref={menu} className={styles.wrap}>
      <RoundButton
        icon={Share}
        label={t('shareMenu.share')}
        size={size}
        variant={open ? 'on' : variant}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen(!open)}
      />
      {/* A menu under the button on a computer; on a phone, the app's dialog, as every other one. */}
      {open && !phone && (
        <div ref={panel} className={`${styles.menu} ${styles.popover}`} role="menu" aria-label={heading}>
          <span className={styles.heading}>{heading}</span>
          {options}
        </div>
      )}
      {phone && (
        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          title={heading}
          intro={<RichText i18nKey="dialogIntro.share" />}
        >
          <div role="menu" aria-label={heading}>
            {options}
          </div>
        </Dialog>
      )}
    </div>
  )
}

export default ShareMenu
