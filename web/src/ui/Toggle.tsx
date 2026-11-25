import styles from './Toggle.module.css'

interface ToggleProps {
  checked: boolean
  label: string
  disabled?: boolean
  onChange: (checked: boolean) => void
}

// The charter's switch: green with a white knob when on, a dim knob when off.
const Toggle = ({ checked, label, disabled = false, onChange }: ToggleProps) => (
  <button
    type="button"
    role="switch"
    className={styles.toggle}
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
  >
    <span className={styles.knob} />
  </button>
)

export default Toggle
