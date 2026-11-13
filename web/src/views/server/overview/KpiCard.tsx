import { useTranslation } from 'react-i18next'
import { Area, AreaChart, ResponsiveContainer } from 'recharts'
import type { ServerDay } from '../../../api.ts'
import { getLanguage } from '../../../lib/i18n.ts'
import { changeOf, shortFigure } from '../../../lib/overview-figures.ts'
import Chip from '../../../ui/Chip.tsx'
import { type Metric, valueOf } from './metrics.ts'
import styles from './Overview.module.css'

interface KpiCardProps {
  metric: Metric
  days: ServerDay[]
  previous: ServerDay[]
  chosen: boolean
  onChoose: () => void
}

// One figure of the period, its change against the period before, and its line. Chosen, it drives the large chart.
const KpiCard = ({ metric, days, previous, chosen, onChoose }: KpiCardProps) => {
  const { t } = useTranslation()
  const language = getLanguage()
  const value = valueOf(metric, days)
  const change = changeOf(value, previous.length ? valueOf(metric, previous) : null)
  const { text, thousands } = shortFigure(value, language, metric.average || metric.hours ? 1 : 0)
  const colour = chosen ? 'var(--rust)' : 'var(--text-3)'
  const label = t(`server.overview.metrics.${metric.id}`)
  return (
    <button type="button" className={styles.kpi} aria-pressed={chosen} onClick={onChoose}>
      <span className={styles.label}>{label}</span>
      <span className={styles.kpiLine}>
        <strong className={styles.figure} title={value.toLocaleString(language, { maximumFractionDigits: 1 })}>
          {text}
          {thousands && <small>K</small>}
          {metric.hours && <small> {t('server.overview.hoursUnit')}</small>}
        </strong>
        {change !== null && (
          <Chip tone={change === 0 ? undefined : change > 0 ? 'success' : 'danger'}>
            {change === 0 ? '=' : change > 0 ? '↑' : '↓'} {Math.abs(change).toLocaleString(language)} %
          </Chip>
        )}
      </span>
      <span className={styles.spark} aria-hidden="true">
        <ResponsiveContainer width="100%" height={36}>
          <AreaChart
            data={days.map(day => ({ value: metric.pick(day) }))}
            margin={{ top: 2, right: 0, bottom: 0, left: 0 }}
          >
            <defs>
              <linearGradient id={`spark-${metric.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colour} stopOpacity={0.28} />
                <stop offset="100%" stopColor={colour} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area
              type="monotone"
              dataKey="value"
              stroke={colour}
              strokeWidth={1.5}
              fill={`url(#spark-${metric.id})`}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </span>
    </button>
  )
}

export default KpiCard
