import { ChevronDown } from 'lucide-react'
import { type ReactNode, useId } from 'react'
import styles from './Accordion.module.css'

// Folding cards, one under the other.
export const AccordionGroup = ({ children }: { children: ReactNode }) => <div className={styles.group}>{children}</div>

// One card of an AccordionGroup: its header (title, count, chevron) opens and closes what it holds. An action (a
// button about the whole group) sits in the header, beside the chevron.
const Accordion = ({
  title,
  lead,
  count,
  open,
  onToggle,
  action,
  tour,
  intro,
  children
}: {
  title: string
  // Before the title: a profile's avatar.
  lead?: ReactNode
  count?: number
  open: boolean
  onToggle: () => void
  action?: ReactNode
  // What the tour lights up on its header.
  tour?: string
  // A line or two at the top of what it holds: what this group is, as a dialog's intro.
  intro?: ReactNode
  children: ReactNode
}) => {
  const bodyId = useId()
  return (
    <section className={styles.accordion}>
      <h2 className={styles.heading}>
        <button
          type="button"
          className={styles.header}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
          data-tour={tour}
        >
          {lead}
          <span className={styles.title}>{title}</span>
          {count !== undefined && <span className={styles.count}>{count}</span>}
          <span className={styles.chevron} aria-hidden="true">
            <ChevronDown size={16} />
          </span>
        </button>
        {action && <span className={styles.action}>{action}</span>}
      </h2>
      <div id={bodyId} className={`${styles.body} appear`} hidden={!open}>
        {intro && <p className={styles.intro}>{intro}</p>}
        {children}
      </div>
    </section>
  )
}

export default Accordion
