import type { ReactNode } from 'react'
import styles from './Settings.module.css'

// A group of rows in a settings page: its label in small capitals, then its rows in one card, as every section
// draws them. For plugins' pages.
const SettingsCard = ({ label, children }: { label?: string; children: ReactNode }) => (
  <>
    {label && <h2 className={styles.label}>{label}</h2>}
    <div className={styles.card}>{children}</div>
  </>
)

export default SettingsCard
