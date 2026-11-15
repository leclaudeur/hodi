import styles from './Toggle.module.css'

interface ToggleProps {
  checked: boolean
  label: string
  disabled?: boolean
  onChange: (checked: boolean) => void
}

// The charter's switch: a white pill with a dark knob when on, a dim one when off.
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
