import type { ReactNode } from 'react'
import styles from './Reader.module.css'

interface ReaderButtonProps {
  children: ReactNode
  // A Lucide icon at 12 px, before the text.
  icon?: ReactNode
  onClick: () => void
  // Set once the action is done for this article, as "Signalé".
  done?: boolean
  label?: string
}

// A button at the end of an article, drawn as "Lire l'original" beside it: for plugins' reader actions.
const ReaderButton = ({ children, icon, onClick, done = false, label }: ReaderButtonProps) => (
  <button
    type="button"
    className={`${styles.seeOn} ${done ? styles.seeOnDone : ''}`}
    onClick={onClick}
    aria-label={label}
  >
    {icon}
    {children}
  </button>
)

export default ReaderButton
