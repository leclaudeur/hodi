import type { ReactNode } from 'react'
import styles from './DialogActions.module.css'

// A dialog's answers, the same in every one: under a line, "Annuler" far left and the action far right.
const DialogActions = ({ children }: { children: ReactNode }) => <div className={styles.actions}>{children}</div>

export default DialogActions
