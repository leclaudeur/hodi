import type { ReactNode } from 'react'
import { AlertCircle, Info } from 'lucide-react'
import styles from './StatusLine.module.css'

interface StatusLineProps {
  tone: 'info' | 'error'
  children: ReactNode
  className?: string
}

// A line under a field, with its icon: blue to say what is going on, red when something failed.
const StatusLine = ({ tone, children, className = '' }: StatusLineProps) => {
  const Icon = tone === 'info' ? Info : AlertCircle
  return (
    <p className={`${styles.status} ${styles[tone]} ${className}`} role={tone === 'error' ? 'alert' : 'status'}>
      <span className={styles.mark}>
        <Icon size={16} aria-hidden="true" />
      </span>
      {/* One box for the text, so a sentence with bold words wraps as one. */}
      <span>{children}</span>
    </p>
  )
}

export default StatusLine
