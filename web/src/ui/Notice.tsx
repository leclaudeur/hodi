import { ChevronDown, CircleHelp, type LucideIcon } from 'lucide-react'
import { type ReactNode, useId, useState } from 'react'
import styles from './Notice.module.css'

// Blue: how a screen works, what a setting does, why an article opens elsewhere. Built like the AI cards
// (round mark, title, text below); the AI keeps violet, errors their own colour.
// Without an icon, it is context: a "?" mark, folded under its title until opened, as the accordions. With one
// (an article that opens elsewhere, notifications this browser lacks), it says what is going on: always open.
const Notice = ({
  title,
  icon,
  actions,
  side,
  href,
  children
}: {
  title: string
  icon?: LucideIcon
  // Buttons under the text.
  actions?: ReactNode
  // Round buttons at the right of the title and text, centred on them.
  side?: ReactNode
  // The whole notice opens this page, in a new tab (its round button says where, for the keyboard).
  href?: string
  children: ReactNode
}) => {
  const [open, setOpen] = useState(false)
  const body = useId()
  const Icon = icon ?? CircleHelp
  const folding = !icon
  const mark = (
    <span className={styles.mark} aria-hidden="true">
      <Icon size={14} />
    </span>
  )

  const main = (
    <>
      {folding ? (
        <h3 className={styles.heading}>
          <button
            type="button"
            className={styles.header}
            aria-expanded={open}
            aria-controls={body}
            onClick={() => setOpen(!open)}
          >
            {mark}
            <span className={styles.title}>{title}</span>
            <span className={styles.chevron} aria-hidden="true">
              <ChevronDown size={16} />
            </span>
          </button>
        </h3>
      ) : (
        <div className={styles.header}>
          {mark}
          <h3 className={styles.title}>{title}</h3>
        </div>
      )}
      <div id={body} className={`${styles.content} ${folding ? 'appear' : ''}`} hidden={folding && !open}>
        <div className={styles.text}>{children}</div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
    </>
  )

  return side ? (
    <aside className={`${styles.notice} ${styles.withSide} ${href ? styles.linked : ''}`}>
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
      <div className={styles.main}>{main}</div>
      <div className={styles.side}>{side}</div>
    </aside>
  ) : (
    <aside className={styles.notice}>{main}</aside>
  )
}

export default Notice
