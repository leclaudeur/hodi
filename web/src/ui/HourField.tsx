import { Time } from '@internationalized/date'
import { DateInput, DateSegment, I18nProvider, TimeField } from 'react-aria-components'
import { LOCALES, useHourCycle } from '../lib/format.ts'
import { useLanguage } from '../lib/i18n.ts'
import styles from './TimeRangeField.module.css'

const pad = (value: number) => String(value).padStart(2, '0')
const toTime = (hhmm: string) => {
  const [hour = 0, minute = 0] = hhmm.split(':').map(Number)
  return new Time(hour, minute)
}

// One hour, typed or stepped with the arrows, written as the household chose in Réglages › Foyer: "21:00" or
// "9:00 PM". The browser's own time field follows the device's language instead, so it is not used. Loaded with
// the fields that need it (react-aria is heavy for the rest of the app).
const HourField = ({ value, label, onChange }: { value: string; label: string; onChange: (value: string) => void }) => {
  const hourCycle = useHourCycle()
  const language = useLanguage()
  return (
    <I18nProvider locale={LOCALES[language]}>
      <TimeField
        aria-label={label}
        className={styles.time}
        value={toTime(value)}
        hourCycle={hourCycle}
        shouldForceLeadingZeros={hourCycle === 24}
        onChange={time => time && onChange(`${pad(time.hour)}:${pad(time.minute)}`)}
      >
        <DateInput className={styles.input}>
          {segment => <DateSegment segment={segment} className={styles.segment} />}
        </DateInput>
      </TimeField>
    </I18nProvider>
  )
}

export default HourField
