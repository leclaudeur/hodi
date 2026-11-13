import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import styles from './Checkbox.module.css'

interface CheckboxProps {
  checked: boolean
  onChange: (checked: boolean) => void
  children: ReactNode
  disabled?: boolean
}

// A statement the person ticks ("J'ai au moins 13 ans"): the square check of "Partager à", then its text.
const Checkbox = ({ checked, onChange, children, disabled = false }: CheckboxProps) => (
  <button
    type="button"
    role="checkbox"
    aria-checked={checked}
    disabled={disabled}
    className={styles.row}
    onClick={() => onChange(!checked)}
  >
    <span className={`${styles.check} ${checked ? styles.on : ''}`} aria-hidden="true">
      {checked && <Check size={12} strokeWidth={3} />}
    </span>
    <span className={styles.label}>{children}</span>
  </button>
)

export default Checkbox
