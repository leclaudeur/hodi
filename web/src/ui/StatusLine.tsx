import type { ReactNode } from 'react'
import { AlertCircle, CircleCheck, Info } from 'lucide-react'
import styles from './StatusLine.module.css'

interface StatusLineProps {
  tone: 'info' | 'success' | 'error'
  children: ReactNode
  className?: string
}

const ICONS = { info: Info, success: CircleCheck, error: AlertCircle }

// A line under a field, with its icon: blue to say what is going on, green when it is fine, red when something failed.
const StatusLine = ({ tone, children, className = '' }: StatusLineProps) => {
  const Icon = ICONS[tone]
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
