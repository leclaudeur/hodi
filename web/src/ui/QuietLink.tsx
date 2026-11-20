import type { LucideIcon } from 'lucide-react'
import styles from './QuietLink.module.css'

interface QuietLinkProps {
  icon: LucideIcon
  children: string
  onClick: () => void
}

// A way around under a form (« Code oublié ? »), quieter than its buttons: grey text with its small icon.
const QuietLink = ({ icon: Icon, children, onClick }: QuietLinkProps) => (
  <button type="button" className={styles.link} onClick={onClick}>
    <Icon size={14} aria-hidden="true" />
    {children}
  </button>
)

export default QuietLink
