import { type LucideIcon, X } from 'lucide-react'
import type { InputHTMLAttributes } from 'react'
import styles from './TextField.module.css'

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  icon: LucideIcon
  // Named for screen readers: the placeholder is only an example.
  'aria-label': string
  // A search: the round cross of the search page empties it, once there is something to empty.
  onClear?: () => void
}

// The settings' one-line field: a pill as tall as a button, its icon, then the text. Beside a Button in a
// fieldRow, it takes the room left.
const TextField = ({ icon: Icon, type = 'text', onClear, ...props }: TextFieldProps) => (
  <label className={`${styles.field} ${onClear ? styles.clearable : ''}`}>
    <Icon size={16} aria-hidden="true" />
    <input type={type} {...props} />
    {onClear && props.value !== '' && (
      <button type="button" className={styles.clear} aria-label="Effacer" onClick={onClear}>
        <X size={14} aria-hidden="true" />
      </button>
    )}
  </label>
)

export default TextField
