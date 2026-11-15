import type { ReactNode } from 'react'
import styles from './Segmented.module.css'

interface SegmentedProps<T extends string | number> {
  label: string
  value: T
  options: { value: T; label: ReactNode; title?: string }[]
  onChange: (value: T) => void
  // The whole width, shared evenly between the choices.
  wide?: boolean
}

// One choice among a few, in a pill: the chosen one is a light pill ("Clair · Sombre · Système", "7 jours · 30 jours").
const Segmented = <T extends string | number>({ label, value, options, onChange, wide = false }: SegmentedProps<T>) => (
  <div className={`${styles.group} ${wide ? styles.wide : ''}`} role="radiogroup" aria-label={label}>
    {options.map(option => (
      <button
        key={option.value}
        type="button"
        role="radio"
        aria-checked={option.value === value}
        aria-label={option.title}
        title={option.title}
        className={styles.option}
        onClick={() => onChange(option.value)}
      >
        {option.label}
      </button>
    ))}
  </div>
)

export default Segmented
