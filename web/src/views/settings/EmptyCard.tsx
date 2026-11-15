import type { ReactNode } from 'react'
import SettingRow from './SettingRow.tsx'
import styles from './Settings.module.css'

interface EmptyCardProps {
  // The rows' own mark, quiet.
  icon: ReactNode
  title: string
  // One line: how to fill the list.
  hint: string
}

// A list of words with none yet: the card its rows will fill, in dashes, with one row saying how to start.
const EmptyCard = ({ icon, title, hint }: EmptyCardProps) => (
  <div className={`${styles.card} ${styles.emptyCard}`}>
    <SettingRow
      lead={
        <span className={`${styles.tile} ${styles.emptyTile}`} aria-hidden="true">
          {icon}
        </span>
      }
      label={title}
      hint={hint}
    />
  </div>
)

export default EmptyCard
