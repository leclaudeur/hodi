import type { ReactNode } from 'react'
import styles from './Settings.module.css'

interface SettingRowProps {
  label: ReactNode
  // A count or a state, in mono beside the label.
  meta?: ReactNode
  // What it does, under the label.
  hint?: ReactNode
  // A mark before the text: a followed subject's star, a profile's avatar.
  lead?: ReactNode
  // In a list (ul.card) or a card of rows (div.card).
  as?: 'div' | 'li'
  className?: string
  // What acts on it, at the end: a switch, a button, a segmented control.
  children?: ReactNode
}

// One row of a settings card: its name, what it does, then what changes it.
const SettingRow = ({ label, meta, hint, lead, as: Tag = 'div', className = '', children }: SettingRowProps) => (
  <Tag className={`${styles.row} ${className}`}>
    {lead}
    <span className={styles.rowText}>
      {meta === undefined ? (
        <span className={styles.rowLabel}>{label}</span>
      ) : (
        <span className={styles.rowTitle}>
          <span className={styles.rowLabel}>{label}</span>
          <span className={styles.mono}>{meta}</span>
        </span>
      )}
      {hint !== undefined && <span className={styles.rowHint}>{hint}</span>}
    </span>
    {children}
  </Tag>
)

export default SettingRow
