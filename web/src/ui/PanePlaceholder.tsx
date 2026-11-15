import { type CSSProperties, type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import emptyStyles from './EmptyState.module.css'
import styles from './PanePlaceholder.module.css'

interface PanePlaceholderProps {
  icon: ReactNode
  title: string
  children: ReactNode
}

const GLOWS = 5

// The desktop reader beside a list, until something is opened: an empty list's tile, title and line (the same
// styles as EmptyState), then the keys to get there. Behind, soft blurs of the theme's colours drift slowly.
const PanePlaceholder = ({ icon, title, children }: PanePlaceholderProps) => {
  const { t } = useTranslation()
  // Each glow starts somewhere else on its path every time, so the drift never looks the same twice.
  const [starts] = useState(() => Array.from({ length: GLOWS }, () => Math.random()))
  return (
    <div className={styles.wrap}>
      <div className={styles.glows} aria-hidden="true">
        {starts.map((start, index) => (
          // eslint-disable-next-line @eslint-react/no-array-index-key -- a fixed set of glows
          <i key={index} style={{ '--start': start } as CSSProperties} />
        ))}
      </div>
      <div className={styles.grain} aria-hidden="true" />
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
