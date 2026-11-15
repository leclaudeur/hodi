import { hourText } from '../../../../lib/format.ts'
import { t } from '../../../../lib/i18n.ts'

const pad = (value: number) => String(value).padStart(2, '0')

// "01 h 30", "02 h 00", "00 h 45": always two digits each, as the hours.
export const formatMinutes = (minutes: number) =>
  t('young.hm', { h: pad(Math.floor(minutes / 60)), m: pad(minutes % 60) })

// "21:00 – 07:00", or "9:00 PM – 7:00 AM" in a household on 12 hours.
export const formatRange = (range: { start: string; end: string }) =>
  t('young.range', { start: hourText(range.start), end: hourText(range.end) })
