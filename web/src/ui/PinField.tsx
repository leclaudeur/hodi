import { useRef } from 'react'
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
  // The number of characters: 8 for the setup code and the codes of « J'ai un code », 6 for an authenticator app's.
  length: number
  // The digits drawn as dots; a code copied from a log is easier to check when it shows.
  masked?: boolean
  // The characters it takes, digits by default; the setup code and a code of « J'ai un code » also have capital
  // letters, typed in any case, and are drawn in two groups of four to read them out.
  characters?: RegExp
}

// One box per digit, as an activation code. One real input lies over them: the phone's number pad
// and paste work as on any field; the boxes only draw what it holds. Password managers are kept out: a code is not a
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
  length,
  masked = true,
  characters
}: PinFieldProps) => {
  const input = useRef<HTMLInputElement>(null)

  return (
    <label
      className={`${styles.field} ${styles[state]} ${align === 'start' ? styles.start : ''} ${masked ? '' : styles.shown}`}
    >
      <span className={styles.label}>{label}</span>
      <span className={`${styles.boxes} ${characters ? styles.grouped : ''}`}>
        <input
          ref={input}
          className={styles.input}
          type="text"
          inputMode={characters ? 'text' : 'numeric'}
          pattern={characters ? undefined : '[0-9]*'}
          autoCapitalize={characters ? 'characters' : 'off'}
          maxLength={characters ? undefined : length}
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
            const typed = event.target.value
            const next = (
              characters ? (typed.toUpperCase().match(characters) ?? []).join('') : typed.replace(/\D/g, '')
            ).slice(0, length)
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
