import type { ReactNode } from 'react'
import styles from './DialogActions.module.css'

// A dialog's answers, the same in every one (and on the full-page steps): under a line, "Annuler" far left and the action far right.
const DialogActions = ({ className = '', children }: { className?: string; children: ReactNode }) => (
  <div className={`${styles.actions} ${className}`}>{children}</div>
)

export default DialogActions
