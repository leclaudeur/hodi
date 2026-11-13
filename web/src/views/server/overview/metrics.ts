import type { TFunction } from 'i18next'
import type { ServerDay } from '../../../api.ts'

// The quick periods, in days (0: « Tout », from the server's first day with numbers).
export type Span = 7 | 30 | 90 | 365 | 0
export const SPANS: Span[] = [7, 30, 90, 365, 0]

export type MetricId = 'visits' | 'articles' | 'hours' | 'videos' | 'shares'

export interface Metric {
  id: MetricId
  pick: (day: ServerDay) => number
  // Visits are different profiles each day: their sum means nothing, their daily average does.
  average?: boolean
  hours?: boolean
}

export const METRICS: Metric[] = [
  { id: 'visits', pick: day => day.visits, average: true },
  { id: 'articles', pick: day => day.articles },
  { id: 'hours', pick: day => day.minutes / 60, hours: true },
  { id: 'videos', pick: day => day.videos },
  { id: 'shares', pick: day => day.shares }
]

export const sum = (days: ServerDay[], pick: (day: ServerDay) => number) =>
  days.reduce((total, day) => total + pick(day), 0)

export const valueOf = (metric: Metric, days: ServerDay[]) => {
  const total = sum(days, metric.pick)
  return metric.average ? (days.length ? total / days.length : 0) : total
}

// « 7 jours », « 1 an »: what a chip's « +3 en … » and the chart's legend say about the period.
export const spanText = (t: TFunction, days: number) =>
  days === 365 ? t('server.overview.span.year') : t('count.day', { count: days })
