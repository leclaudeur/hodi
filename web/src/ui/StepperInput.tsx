import { type KeyboardEvent, useState } from 'react'
import { typedDigits, typedNumber } from '../lib/typed-number.ts'
import styles from './Stepper.module.css'

interface StepperInputProps {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}

// The Stepper's value, typed: a number within the bounds counts at once; on leaving, one outside them is brought
// back inside, and an empty field shows the value again.
const StepperInput = ({ label, value, min, max, onChange }: StepperInputProps) => {
  // What is being typed; null outside the field, where the value shows (as the buttons change it).
  const [typed, setTyped] = useState<string | null>(null)
  const draft = typed ?? String(value)

  const type = (text: string) => {
    const digits = typedDigits(text, max)
    setTyped(digits)
    const number = typedNumber(digits, min, max)
    if (number !== null && String(number) === digits) onChange(number)
  }

  const settle = () => {
    const number = typedNumber(draft, min, max) ?? value
    setTyped(null)
    if (number !== value) onChange(number)
  }

  // Enter on a number out of bounds settles it first, rather than sending the form with the last good one.
  const key = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    const number = typedNumber(draft, min, max)
    if (number !== null && String(number) === draft) return
    event.preventDefault()
    settle()
  }

  return (
    <input
      className={`${styles.value} ${styles.input}`}
      aria-label={label}
      inputMode="numeric"
      value={draft}
      onFocus={event => {
        setTyped(String(value))
        event.currentTarget.select()
      }}
      onChange={event => type(event.target.value)}
      onBlur={settle}
      onKeyDown={key}
    />
  )
}

export default StepperInput
