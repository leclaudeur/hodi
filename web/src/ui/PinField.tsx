import { useRef } from 'react'
import { PIN_LENGTH } from '../api.ts'
import styles from './PinField.module.css'

export type PinState = 'idle' | 'wrong' | 'right'

interface PinFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  // The full code typed: the screen checks it at once, no button to press.
  onComplete?: (value: string) => void
  // wrong: the boxes turn red (and shake); right: green, just before the profile opens.
  state?: PinState
  disabled?: boolean
  // start: on the left, as the other fields of a settings form; centred on its own screen ("Qui lit ?").
  align?: 'center' | 'start'
  autoFocus?: boolean
  // The number of digits: a profile's PIN by default, 6 for the setup code.
  length?: number
  // The digits drawn as dots; a code copied from a log is easier to check when it shows.
  masked?: boolean
}

// One box per digit (four for a PIN), as an activation code. One real input lies over them: the phone's number pad
// and paste work as on any field; the boxes only draw what it holds. Password managers are kept out: a PIN is not a
// site's password, and their pop-ups cover the boxes. The input is a plain, invisible text field for that (a
// password one draws them in whatever its autocomplete says), with each manager's own "ignore me" attribute.
const PinField = ({
  label,
  value,
  onChange,
  onComplete,
  state = 'idle',
  disabled = false,
  align = 'center',
  autoFocus,
  length = PIN_LENGTH,
  masked = true
}: PinFieldProps) => {
  const input = useRef<HTMLInputElement>(null)

  return (
    <label
      className={`${styles.field} ${styles[state]} ${align === 'start' ? styles.start : ''} ${masked ? '' : styles.shown}`}
    >
      <span className={styles.label}>{label}</span>
      <span className={styles.boxes}>
        <input
          ref={input}
          className={styles.input}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={length}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          data-1p-ignore=""
          data-lpignore="true"
          data-bwignore=""
          data-form-type="other"
          autoFocus={autoFocus}
          disabled={disabled}
          aria-invalid={state === 'wrong' || undefined}
          value={value}
          onChange={event => {
            const next = event.target.value.replace(/\D/g, '').slice(0, length)
            onChange(next)
            if (next.length === length) onComplete?.(next)
          }}
          // The caret stays at the end: a digit is changed by erasing back to it.
          onSelect={event => {
            const end = event.currentTarget.value.length
            event.currentTarget.setSelectionRange(end, end)
          }}
        />
        {Array.from({ length }, (_, index) => (
          <span
            key={index}
            className={`${styles.box} ${index < value.length ? styles.filled : ''} ${
              index === Math.min(value.length, length - 1) ? styles.next : ''
            }`}
            aria-hidden="true"
          >
            {masked ? null : value[index]}
          </span>
        ))}
      </span>
    </label>
  )
}

export default PinField
