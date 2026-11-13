import { Bar, BarChart, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useTranslation } from 'react-i18next'
import statStyles from './StatsSection.module.css'

export interface Day {
  key: string
  // "LUN", "MAR": the weekday, short and in capitals.
  short: string
  date: number
  count: number
  today: boolean
}

const DayTick = ({ x, y, payload, days }: { x?: number; y?: number; payload?: { index: number }; days: Day[] }) => {
  const day = payload ? days[payload.index] : undefined
  if (!day || x === undefined || y === undefined) return null
  // 30 days: every fifth day and today, so the labels never overlap.
  if (days.length > 7 && !day.today && (days.length - 1 - payload!.index) % 5 !== 0) return null
  return (
    <g transform={`translate(${x},${y})`} className={day.today ? statStyles.todayTick : statStyles.tick}>
      <text textAnchor="middle" dy={12}>
        {day.short}
      </text>
      <text textAnchor="middle" dy={27} className={statStyles.tickDate}>
        {day.date}
      </text>
    </g>
  )
}

const DayTooltip = ({
  active,
  payload,
  unit
}: {
  active?: boolean
  payload?: { payload: Day }[]
  unit: (count: number) => string
}) => {
  const { t } = useTranslation()
  const day = payload?.[0]?.payload
  if (!active || !day) return null
  return (
    <span className={statStyles.tooltip}>
      {t('time.day', { weekday: day.short, numbers: day.date })} · {unit(day.count).toUpperCase()}
    </span>
  )
}

interface DayBarsProps {
  days: Day[]
  // The dashed line across: the daily average.
  average: number
  // "4 LUS", "2 VISITES": the tooltip's count.
  unit: (count: number) => string
  label: string
  height?: number
  // Today's count on top of its bar, written for the language ("0,4").
  figure?: (count: number) => string
}

// A bar per day as Réglages › Statistiques draws them: today in its own colour with its count on top, the average
// dashed across.
const DayBars = ({ days, average, unit, label, height = 220, figure = String }: DayBarsProps) => {
  const max = Math.max(1, ...days.map(day => day.count))
  return (
    <div className={statStyles.chart} role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={days} margin={{ top: 22, right: 0, bottom: 0, left: -24 }}>
          <YAxis ticks={[0, Math.ceil(max / 2), max]} domain={[0, max]} axisLine={false} tickLine={false} width={40} />
          <XAxis
            dataKey="key"
            axisLine={{ className: statStyles.baseline }}
            tickLine={false}
            interval={0}
            height={40}
            tick={<DayTick days={days} />}
          />
          <ReferenceLine y={average} className={statStyles.average} strokeDasharray="3 3" ifOverflow="extendDomain" />
          <Tooltip
            content={<DayTooltip unit={unit} />}
            cursor={{ className: statStyles.cursor }}
            isAnimationActive={false}
          />
          <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={days.length <= 7 ? 22 : 12} isAnimationActive={false}>
            {days.map(day => (
              <Cell key={day.key} className={day.today ? statStyles.todayBar : statStyles.bar} />
            ))}
            <LabelList
              dataKey="count"
              position="top"
              content={({ x, y, width, index }) => {
                const day = index === undefined ? undefined : days[index]
                if (!day?.today || !day.count) return null
                return (
                  <text
                    x={Number(x) + Number(width) / 2}
                    y={Number(y) - 8}
                    textAnchor="middle"
                    className={statStyles.todayLabel}
                  >
                    {figure(day.count)}
                  </text>
                )
              }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export default DayBars
