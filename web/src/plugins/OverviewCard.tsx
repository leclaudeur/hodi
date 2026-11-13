import type { ReactNode } from 'react'
import styles from '../views/server/overview/Overview.module.css'

interface OverviewCardProps {
  // Already in the plugin's words (usePluginTranslation).
  title: string
  // Beside the title, in grey: « Foyers 8 ».
  count?: number
  // At the end of the title's line: a Chip, a caption.
  aside?: ReactNode
  children?: ReactNode
}

// A card of Serveur › Vue d'ensemble: Hodi's own cards and the plugins' look the same and fill their place in the grid.
const OverviewCard = ({ title, count, aside, children }: OverviewCardProps) => (
  <section className={`${styles.card} ${styles.pluginCard}`} aria-label={title}>
    <div className={styles.cardHead}>
      <h2 className={styles.cardTitle}>
        {title}
        {count !== undefined && <span className={styles.count}>{count.toLocaleString()}</span>}
      </h2>
      {aside}
    </div>
    {children}
  </section>
)

export default OverviewCard
