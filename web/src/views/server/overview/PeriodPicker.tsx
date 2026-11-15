import { CalendarRange, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import RoundButton from '../../../ui/RoundButton.tsx'
import Segmented from '../../../ui/Segmented.tsx'
import DatesDialog, { type Dates, dateText } from './DatesDialog.tsx'
import { SPANS, type Span } from './metrics.ts'
import styles from './Overview.module.css'

export type Period = { days: Span } | Dates

// Statistiques' period switch with longer periods, then a button for any two dates. Chosen dates stand in for the
// switch, as tall as it, with a cross back to 7 days.
const PeriodPicker = ({ period, onChange }: { period: Period; onChange: (period: Period) => void }) => {
  const { t } = useTranslation()
  const [picking, setPicking] = useState(false)
  const dates = 'from' in period ? period : null
  const spanLabel = (value: Span) =>
    value === 0
      ? t('server.overview.span.all')
      : value === 365
        ? t('server.overview.span.yearShort')
        : t('server.overview.span.days', { count: value })
  return (
    <div className={styles.periods}>
      {dates ? (
        <span className={styles.dates}>
          {`${dateText(dates.from, false)} – ${dateText(dates.to, false)}`}
          <RoundButton
            icon={X}
            label={t('server.overview.dates.clear')}
            size={28}
            onClick={() => onChange({ days: 7 })}
          />
        </span>
      ) : (
        <Segmented
          label={t('server.overview.period')}
          value={'days' in period ? period.days : 7}
          onChange={days => onChange({ days })}
          options={SPANS.map(value => ({ value, label: spanLabel(value) }))}
        />
      )}
      <RoundButton
        icon={CalendarRange}
        label={t('server.overview.dates.title')}
        size={38}
        onClick={() => setPicking(true)}
      />
      {picking && (
        <DatesDialog
          dates={dates}
          onClose={() => setPicking(false)}
          onApply={next => {
            setPicking(false)
            onChange(next)
          }}
        />
      )}
    </div>
  )
}

export default PeriodPicker
