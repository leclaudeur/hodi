import { ArrowRight, type LucideIcon } from 'lucide-react'
import { Suspense, lazy } from 'react'
import { hourText } from '../lib/format.ts'
import styles from './TimeRangeField.module.css'

const HourField = lazy(() => import('./HourField.tsx'))

interface TimeRangeFieldProps {
  start: string
  end: string
  startLabel: string
  endLabel: string
  // The sun for reading hours, the moon for quiet ones: as on the buttons that show them.
  icon: LucideIcon
  // row: a pill in a settings row; large: the whole width of a dialog, as the Stepper.
  size?: 'row' | 'large'
  onChange: (range: { start: string; end: string }) => void
}

// From one hour to another ("21:00 → 07:00"), written as the buttons that show them: an icon and the UI font. The
// hours show as text for the instant the field's code takes to arrive.
const TimeRangeField = ({
  start,
  end,
  startLabel,
  endLabel,
  icon: Icon,
  size = 'row',
  onChange
}: TimeRangeFieldProps) => (
  <span className={`${styles.field} ${styles[size]}`}>
    <Icon size={size === 'large' ? 18 : 16} aria-hidden="true" className={styles.icon} />
    <Suspense fallback={<span className={styles.input}>{hourText(start)}</span>}>
      <HourField value={start} label={startLabel} onChange={next => onChange({ start: next, end })} />
    </Suspense>
    <ArrowRight size={size === 'large' ? 16 : 14} aria-hidden="true" className={styles.arrow} />
    <Suspense fallback={<span className={styles.input}>{hourText(end)}</span>}>
      <HourField value={end} label={endLabel} onChange={next => onChange({ start, end: next })} />
    </Suspense>
  </span>
)

export default TimeRangeField
