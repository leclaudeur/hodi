import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { type ReactNode, createContext, use, useState } from 'react'
import { createPortal } from 'react-dom'
import PhoneHeader from '../ui/PhoneHeader.tsx'
import RoundButton from '../ui/RoundButton.tsx'
import styles from './MobilePage.module.css'

// The header's right side, for content that has its own controls (the stats' period).
const ActionsSlotContext = createContext<HTMLElement | null>(null)

// Shows its children on the right of the page's title, when inside a MobilePage.
export const HeaderActions = ({ children }: { children: ReactNode }) => {
  const slot = use(ActionsSlotContext)
  return slot ? createPortal(children, slot) : null
}

interface MobilePageProps {
  title: string
  // "6 ARTICLES".
  meta?: string
  // A back button to this link (a topic goes back to the home).
  backHref?: string
  backLabel?: string
  // On the right of the title: the page's own buttons.
  actions?: ReactNode
  // Right after the title: its "?".
  help?: ReactNode
  // A line under the header, held at the top as above an article: for a page of reading.
  divided?: boolean
  // Between the header and the list: the pull band, the filters.
  top?: ReactNode
  children: ReactNode
  // Floating over the list, above the navigation: "Charger <jour>".
  footer?: ReactNode
  busy?: boolean
}

// A page on a phone or a tablet held upright, scrolled with the page, from the charter's "Mobile thème" board.
const MobilePage = ({
  title,
  meta,
  backHref,
  backLabel,
  actions,
  help,
  divided = false,
  top,
  children,
  footer,
  busy = false
}: MobilePageProps) => {
  const { t } = useTranslation()
  const [slot, setSlot] = useState<HTMLElement | null>(null)

  return (
    <section className={styles.page} aria-label={title} aria-busy={busy}>
      <PhoneHeader
        back={
          backHref && <RoundButton icon={ArrowLeft} label={backLabel ?? t('nav.backHome')} size={44} href={backHref} />
        }
        title={title}
        help={<span className={styles.help}>{help}</span>}
        meta={meta}
        actions={
          <span ref={setSlot} className={styles.actions}>
            {actions}
          </span>
        }
        line={divided}
        sticky={divided}
      />
      <ActionsSlotContext value={slot}>
        {top}
        {children}
      </ActionsSlotContext>
      {footer && <div className={styles.footer}>{footer}</div>}
    </section>
  )
}

export default MobilePage
