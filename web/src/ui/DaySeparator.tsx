import { useTranslation } from 'react-i18next'
import styles from './DaySeparator.module.css'

// What a separator counts, as the count.* texts name it.
export type CountUnit = 'article' | 'item' | 'source' | 'read' | 'video' | 'view'

// "AUJOURD'HUI ——— 24 ARTICLES", sticky at the top of its day while it scrolls.
interface DaySeparatorProps {
  label: string
  // Left out: the label alone ("Favoris" in the stats).
  count?: number
  // Instead of a count, on the right ("CETTE SEMAINE").
  note?: string
  first?: boolean
  // What is counted: articles, or items for videos and episodes.
  unit?: CountUnit
  // Scrolls with the list instead of staying at the top ("Reprendre", above the days).
  still?: boolean
  className?: string
}

const DaySeparator = ({
  label,
  count,
  note,
  first = false,
  unit = 'article',
  still = false,
  className = ''
}: DaySeparatorProps) => {
  const { t } = useTranslation()
  return (
    <div
      className={`${styles.separator} ${first ? styles.first : ''} ${still ? styles.still : ''} ${className}`}
      role="heading"
      aria-level={2}
    >
      <span>{label}</span>
      <span className={styles.line} aria-hidden="true" />
      {note !== undefined && <span>{note}</span>}
      {count !== undefined && <span>{t(`count.${unit}`, { count })}</span>}
      {/* Only for a held separator: a still one would hang it under the nearest placed box, a dialog's bottom. */}
      {!still && <span className={styles.fade} aria-hidden="true" />}
    </div>
  )
}

export default DaySeparator
