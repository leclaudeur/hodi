import type { ReactNode } from 'react'
import styles from './EmptyState.module.css'

interface EmptyStateProps {
  icon: ReactNode
  title: string
  children?: ReactNode
  // The buttons under the text.
  actions?: ReactNode
  tone?: 'default' | 'danger'
  // Above other content (the saved articles, offline): not centred in the whole page.
  compact?: boolean
}

// A list with nothing to show, or that failed to load: from the charter's "États d'erreur".
const EmptyState = ({ icon, title, children, actions, tone = 'default', compact = false }: EmptyStateProps) => (
  <div className={`${styles.wrap} ${compact ? styles.compact : ''}`}>
    <div className={styles.state} role={tone === 'danger' ? 'alert' : undefined}>
      <span className={`${styles.icon} ${styles[tone]}`} aria-hidden="true">
        {icon}
      </span>
      <h2 className={styles.title}>{title}</h2>
      {children && <p className={styles.text}>{children}</p>}
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  </div>
)

export default EmptyState
