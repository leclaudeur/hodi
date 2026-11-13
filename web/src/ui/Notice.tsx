import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import Button from './Button.tsx'
import styles from './Notice.module.css'
import RoundButton from './RoundButton.tsx'

export type NoticeTone = 'info' | 'warning' | 'error'

export interface NoticeAction {
  label: string
  icon: LucideIcon
  onClick?: () => void
  href?: string
}

// A card that says what is going on, built as a settings row: a coloured square with its icon at the top left, a
// title, a description, and maybe one button at the end (a round one on a phone). Blue for information, yellow for
// a warning (a plugin nobody checked), red for an error (a plugin off because it is too old). The AI keeps violet.
const Notice = ({
  title,
  icon: Icon,
  tone = 'info',
  action,
  side,
  href,
  children
}: {
  title: string
  icon: LucideIcon
  tone?: NoticeTone
  // One button at the end.
  action?: NoticeAction
  // Round buttons at the end, instead of a labelled one.
  side?: ReactNode
  // The whole notice opens this page, in a new tab (its round button says where, for the keyboard).
  href?: string
  children: ReactNode
}) => (
  <aside className={`${styles.notice} ${styles[tone]} ${href ? styles.linked : ''}`}>
    {href && (
      <a
        className={styles.cover}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        tabIndex={-1}
        aria-hidden="true"
      />
    )}
    <span className={styles.mark} aria-hidden="true">
      <Icon size={20} />
    </span>
    <div className={styles.main}>
      <h3 className={styles.title}>{title}</h3>
      <div className={styles.text}>{children}</div>
    </div>
    {action && (
      <div className={styles.side}>
        <Button className={styles.wideAction} icon={action.icon} onClick={action.onClick} href={action.href}>
          {action.label}
        </Button>
        <RoundButton
          className={styles.roundAction}
          icon={action.icon}
          label={action.label}
          size={38}
          onClick={action.onClick}
          href={action.href}
        />
      </div>
    )}
    {side && <div className={styles.side}>{side}</div>}
  </aside>
)

export default Notice
