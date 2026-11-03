import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import emptyStyles from './EmptyState.module.css'
import styles from './PanePlaceholder.module.css'

interface PanePlaceholderProps {
  icon: ReactNode
  title: string
  children: ReactNode
}

// The desktop reader beside a list, until something is opened: an empty list's tile, title and line (the same
// styles as EmptyState), then the keys to get there.
const PanePlaceholder = ({ icon, title, children }: PanePlaceholderProps) => {
  const { t } = useTranslation()
  return (
    <div className={styles.wrap}>
      <div className={emptyStyles.state}>
        <span className={emptyStyles.icon} aria-hidden="true">
          {icon}
        </span>
        <h2 className={emptyStyles.title}>{title}</h2>
        <p className={emptyStyles.text}>{children}</p>
        <span className={`${styles.hint} mono`}>{t('pane.keys')}</span>
      </div>
    </div>
  )
}

export default PanePlaceholder
