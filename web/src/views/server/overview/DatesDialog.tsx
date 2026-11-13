import { ChevronLeft, ChevronRight } from 'lucide-react'
import { type ButtonHTMLAttributes, useState } from 'react'
import { type DateRange, DayPicker } from 'react-day-picker'
import { enGB, fr } from 'react-day-picker/locale'
import 'react-day-picker/style.css'
import { useTranslation } from 'react-i18next'
import { LOCALES } from '../../../lib/format.ts'
import { getLanguage } from '../../../lib/i18n.ts'
import { useMedia } from '../../../lib/use-media.ts'
import Button from '../../../ui/Button.tsx'
import Dialog from '../../../ui/Dialog.tsx'
import DialogActions from '../../../ui/DialogActions.tsx'
import RoundButton from '../../../ui/RoundButton.tsx'
import styles from './DatesDialog.module.css'

export interface Dates {
  from: string
  to: string
}

// A date of the calendar (local midnight) as the server's days, and back.
const dayOf = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const dateOf = (day: string) => new Date(`${day}T00:00:00`)

// « 3 oct. 2026 », as the pills and the page say a chosen date.
export const dateText = (day: string, year = true) =>
  new Intl.DateTimeFormat(LOCALES[getLanguage()], {
    day: 'numeric',
    month: 'short',
    ...(year ? { year: 'numeric' } : {})
  }).format(dateOf(day))

// The two ends of the period, over their month on a computer.
const Ends = ({ range }: { range: DateRange | undefined }) => {
  const { t } = useTranslation()
  return (
    <div className={styles.ends}>
      {(['from', 'to'] as const).map(end => (
        <div key={end} className={styles.end}>
          <span className={styles.endLabel}>{t(`server.overview.dates.${end}`)}</span>
          <span className={styles.endValue}>{range?.[end] ? dateText(dayOf(range[end])) : '—'}</span>
        </div>
      ))}
    </div>
  )
}

type NavProps = ButtonHTMLAttributes<HTMLButtonElement>

// The calendar's arrows: Hodi's round buttons, at the size of a card's actions.
const PreviousMonth = ({ onClick, disabled }: NavProps) => {
  const { t } = useTranslation()
  return (
    <RoundButton
      icon={ChevronLeft}
      label={t('server.overview.dates.previous')}
      size={28}
      onClick={onClick}
      disabled={disabled}
    />
  )
}

const NextMonth = ({ onClick, disabled }: NavProps) => {
  const { t } = useTranslation()
  return (
    <RoundButton
      icon={ChevronRight}
      label={t('server.overview.dates.next')}
      size={28}
      onClick={onClick}
      disabled={disabled}
    />
  )
}

// Any period up to today: its first day, then its last, on two months (one on a phone).
const DatesDialog = ({
  dates,
  onClose,
  onApply
}: {
  dates: Dates | null
  onClose: () => void
  onApply: (dates: Dates) => void
}) => {
  const { t } = useTranslation()
  const months = useMedia('(min-width: 760px)') ? 2 : 1
  const today = new Date()
  const [range, setRange] = useState<DateRange | undefined>(() =>
    dates ? { from: dateOf(dates.from), to: dateOf(dates.to) } : undefined
  )
  const last = range?.to ?? today
  return (
    <Dialog
      open
      onClose={onClose}
      size={months === 2 ? 'wide' : undefined}
      className={styles.dialog}
      title={t('server.overview.dates.title')}
    >
      <Ends range={range} />
      <DayPicker
        className={styles.picker}
        mode="range"
        locale={getLanguage() === 'fr' ? fr : enGB}
        weekStartsOn={1}
        numberOfMonths={months}
        defaultMonth={new Date(last.getFullYear(), last.getMonth() - (months - 1), 1)}
        disabled={{ after: today }}
        selected={range}
        onSelect={setRange}
        components={{ PreviousMonthButton: PreviousMonth, NextMonthButton: NextMonth }}
      />
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          look="primary"
          disabled={!range?.from || !range.to}
          onClick={() => range?.from && range.to && onApply({ from: dayOf(range.from), to: dayOf(range.to) })}
        >
          {t('server.overview.dates.apply')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default DatesDialog
