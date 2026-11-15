import { AlertCircle, Info } from 'lucide-react'
import styles from './StatusLine.module.css'

interface StatusLineProps {
  tone: 'info' | 'error'
  children: string
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
      {children}
    </p>
  )
}

export default StatusLine
