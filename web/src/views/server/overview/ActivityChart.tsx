import type { TFunction } from 'i18next'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { ServerDay } from '../../../api.ts'
import { evenTicks } from '../../../lib/even-ticks.ts'
import { getLanguage } from '../../../lib/i18n.ts'
import type { Metric } from './metrics.ts'
import styles from './Overview.module.css'

// « Ces 7 jours » and « Les 7 jours d'avant »; « Tout » has no period before.
const legendOf = (t: TFunction, span: number) => {
  if (!span) return { current: t('server.overview.legend.all'), before: '' }
  if (span === 365) return { current: t('server.overview.legend.year'), before: t('server.overview.legend.yearBefore') }
  return {
    current: t('server.overview.legend.days', { count: span }),
    before: t('server.overview.legend.daysBefore', { count: span })
  }
}

const Legend = ({ current, before }: { current: string; before: string }) => (
  <ul className={styles.legend}>
    <li>
      <i className={styles.lineKey} />
      {current}
    </li>
    {before && (
      <li>
        <i className={styles.dashKey} />
        {before}
      </li>
    )}
  </ul>
)

interface TickProps {
  x?: number
  y?: number
  payload?: { value: string | number }
}

// The axis's figures written from the content's left edge, not right-aligned in a margin.
const FigureTick = ({ y, payload }: TickProps) => (
  <text x={0} y={y} dy={3} textAnchor="start" className={styles.tick}>
    {payload?.value}
  </text>
)

const anchorOf = (value: string, first: string, last: string) => {
  if (value === first) return 'start'
  return value === last ? 'end' : 'middle'
}

interface DayTickProps extends TickProps {
  first: string
  last: string
  // On a narrow card, only the day's number (« 11 ») so every day keeps its label.
  numbers?: Map<string, string>
}

// The days under the curve: the first starts on its point and the last ends on its, so neither leaves the card.
const DayTick = ({ x, y, payload, first, last, numbers }: DayTickProps) => {
  const value = String(payload?.value ?? '')
  return (
    <text x={x} y={y} dy={12} textAnchor={anchorOf(value, first, last)} className={styles.tick}>
      {numbers?.get(value) ?? value}
    </text>
  )
}

const TOOLTIP = {
  contentStyle: {
    background: 'var(--text)',
    border: 'none',
    borderRadius: 8,
    fontFamily: 'var(--font-mono)',
    fontSize: 11
  },
  itemStyle: { color: 'var(--bg)', padding: 0 },
  labelStyle: { color: 'var(--bg)', marginBottom: 4 }
}

// A day's label (« MER. 11 », « 12 NOV. ») or its number alone, with the room around it; the figures' axis on the left.
const DAY_WIDTH = 64
const NUMBER_WIDTH = 28
const FIGURES_WIDTH = 34

// Which days are written under the curve, and whether as their number alone.
const axisOf = (days: ServerDay[], data: { label: string }[], width: number, short: boolean) => {
  const room = width - FIGURES_WIDTH
  const full = evenTicks(data.length, room, DAY_WIDTH)
  // A week that does not fit in full keeps every day, as numbers.
  const compact =
    short && full.length < data.length && evenTicks(data.length, room, NUMBER_WIDTH).length === data.length
  const ticks = (compact ? data.map((_, index) => index) : full).map(index => data[index]!.label)
  const numbers = compact
    ? new Map(days.map((day, index) => [data[index]!.label, String(Number(day.day.slice(8)))]))
    : undefined
  return { ticks, numbers }
}

interface ActivityChartProps {
  metric: Metric
  days: ServerDay[]
  previous: ServerDay[]
  span: number
}

// The chosen figure day by day, the period before dashed behind it.
const ActivityChart = ({ metric, days, previous, span }: ActivityChartProps) => {
  const { t } = useTranslation()
  const [width, setWidth] = useState(0)
  const short = days.length <= 31
  const dayText = new Intl.DateTimeFormat(
    getLanguage(),
    short ? { weekday: 'short', day: 'numeric', timeZone: 'UTC' } : { day: 'numeric', month: 'short', timeZone: 'UTC' }
  )
  const round = (day: ServerDay | undefined) => (day ? Math.round(metric.pick(day) * 10) / 10 : undefined)
  const data = days.map((day, index) => ({
    label: dayText.format(new Date(`${day.day}T12:00:00Z`)),
    value: round(day),
    before: round(previous[index])
  }))
  const { ticks, numbers } = axisOf(days, data, width, short)
  const legend = legendOf(t, span)
  const label = t(`server.overview.metrics.${metric.id}`)
  return (
    <section className={`${styles.card} ${styles.activity}`} aria-labelledby="overview-activity">
      <div className={styles.cardHead}>
        <h2 id="overview-activity" className={styles.cardTitle}>
          {t('server.overview.byDay', { metric: label })}
        </h2>
        <Legend current={legend.current} before={previous.length ? legend.before : ''} />
      </div>
      <div className={styles.chart}>
        <ResponsiveContainer width="100%" height="100%" onResize={next => setWidth(next)}>
          <AreaChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="activity-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--rust)" stopOpacity={0.24} />
                <stop offset="100%" stopColor="var(--rust)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--divider)" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              ticks={ticks}
              interval={0}
              tickMargin={8}
              tick={<DayTick first={data[0]?.label ?? ''} last={data.at(-1)?.label ?? ''} numbers={numbers} />}
            />
            <YAxis tickLine={false} axisLine={false} width={FIGURES_WIDTH} tick={<FigureTick />} />
            <Tooltip isAnimationActive={false} cursor={{ className: styles.cursor }} {...TOOLTIP} />
            {previous.length > 0 && (
              <Area
                type="monotone"
                dataKey="before"
                name={legend.before}
                stroke="var(--text-3)"
                strokeDasharray="4 4"
                strokeWidth={1.5}
                fill="none"
                isAnimationActive={false}
              />
            )}
            <Area
              type="monotone"
              dataKey="value"
              name={label}
              stroke="var(--rust)"
              strokeWidth={2.5}
              fill="url(#activity-fill)"
              dot={short ? { r: 3, fill: 'var(--rust)', strokeWidth: 0 } : false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}

export default ActivityChart
