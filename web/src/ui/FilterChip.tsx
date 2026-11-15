import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import styles from './FilterChip.module.css'

interface FilterChipProps {
  selected: boolean
  // A filter on the page, or a link to a page (the home row's "Tout").
  onClick?: () => void
  href?: string
  // How many it keeps, after the label: "TOUT · 12".
  count?: number
  icon?: LucideIcon
  disabled?: boolean
  children: ReactNode
}

// A filter of a row ("Tout", "Peu ouvertes", a followed subject): a pill, white when on. A topic's filter is
// its TopicCapsule, in its colours, the same size.
const FilterChip = ({ selected, onClick, href, count, icon: Icon, disabled = false, children }: FilterChipProps) => {
  const className = `${styles.chip} ${selected ? styles.selected : ''}`
  const content = (
    <>
      {Icon && <Icon size={14} aria-hidden="true" />}
      {children}
      {count !== undefined && ` · ${count}`}
    </>
  )

  return href ? (
    <a className={className} href={href} aria-current={selected ? 'page' : undefined}>
      {content}
    </a>
  ) : (
    <button type="button" className={className} aria-pressed={selected} disabled={disabled} onClick={onClick}>
      {content}
    </button>
  )
}

export default FilterChip
