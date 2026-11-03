import { useState, useSyncExternalStore } from 'react'
import { type TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { Bar, BarChart, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { TopicInfo } from '../../../api.ts'
import { type ReadingEntry, getReadings, isRead, isVideoReading, startOfDay } from '../../../lib/reading-stats.ts'
import { getLanguage } from '../../../lib/i18n.ts'
import { subscribeUserState } from '../../../lib/user-state.ts'
import Segmented from '../../../ui/Segmented.tsx'
import DaySeparator, { type CountUnit } from '../../../ui/DaySeparator.tsx'
import SourceAvatar from '../../../ui/SourceAvatar.tsx'
import SectionPage from '../SectionPage.tsx'
import StatsHousehold from './StatsHousehold.tsx'
import styles from '../Settings.module.css'
import statStyles from './StatsSection.module.css'

const DAY_MS = 24 * 60 * 60 * 1000
const TOP_ROWS = 4

// "2 H 40", "45 MIN".
const durationLabel = (total: number) => {
  const minutes = Math.round(total)
  return minutes < 60 ? `${minutes} MIN` : `${Math.floor(minutes / 60)} H ${String(minutes % 60).padStart(2, '0')}`
}

// Left past this share, a skimmed article or video is still under way: it is in "Reprendre".
const STARTED = 0.15

// What a card counts: its words are under stats.*.article or stats.*.video.
type Kind = 'article' | 'video'

// The opened entries of the period that were not read or seen for good: started and left for later
// ("Reprendre"), or only skimmed.
const splitOf = (opened: ReadingEntry[]) => {
  const notRead = opened.filter(entry => !isRead(entry))
  const started = notRead.filter(entry => (entry.progress ?? 0) >= STARTED).length
  return { read: opened.length - notRead.length, started, skimmed: notRead.length - started }
}

interface ReadSplitProps {
  split: ReturnType<typeof splitOf>
  kind: Kind
  periodLabel: string
}

// What became of the articles or videos opened: read, started and left for later, or only skimmed. One bar, in
// proportion.
const ReadSplit = ({ split: { read, started, skimmed }, kind, periodLabel }: ReadSplitProps) => {
  const { t } = useTranslation()
  const total = read + started + skimmed
  const id = kind === 'article' ? 'stats-split' : 'stats-video-split'
  if (total === 0) return null
  const share = (count: number) => `${(count / total) * 100}%`
  return (
    <section className={statStyles.card} aria-labelledby={id}>
      <div>
        <h2 id={id} className={statStyles.cardTitle}>
          {t(`stats.split.${kind}.title`)}
        </h2>
        <p className={statStyles.cardIntro}>
          {t(`stats.split.${kind}.intro`, {
            count: total,
            period: periodLabel,
            percent: Math.round((read / total) * 100)
          })}
        </p>
      </div>
      <div className={statStyles.split} aria-hidden="true">
        {read > 0 && <span className={statStyles.splitRead} style={{ width: share(read) }} />}
        {started > 0 && <span className={statStyles.splitStarted} style={{ width: share(started) }} />}
        {skimmed > 0 && <span className={statStyles.splitSkimmed} style={{ width: share(skimmed) }} />}
      </div>
      <ul className={`${styles.mono} ${statStyles.splitLegend}`}>
        <li>
          <i className={statStyles.splitRead} />
          {t(`stats.split.${kind}.read`)} · {read}
        </li>
        <li>
          <i className={statStyles.splitStarted} />
          {t('stats.split.started')} · {started}
        </li>
        <li>
          <i className={statStyles.splitSkimmed} />
          {t(`stats.split.${kind}.skimmed`)} · {skimmed}
        </li>
      </ul>
    </section>
  )
}

interface Day {
  key: string
  short: string
  date: number
  count: number
  today: boolean
}

// The days of the period, oldest first, with what was read on each.
const daysOf = (entries: ReadingEntry[], length: number, now: Date): Day[] => {
  const today = startOfDay(now)
  const weekday = new Intl.DateTimeFormat(getLanguage(), { weekday: 'short' })
  return Array.from({ length }, (_, index) => {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (length - 1 - index))
    const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime()
    return {
      key: day.toISOString(),
      short: weekday.format(day).replace('.', '').toUpperCase(),
      date: day.getDate(),
      count: entries.filter(entry => entry.at >= day.getTime() && entry.at < end).length,
      today: index === length - 1
    }
  })
}

// Days in a row with at least one article (or video), ending today (or yesterday, before today's first one).
const streakOf = (entries: ReadingEntry[], now: Date) => {
  const days = new Set(entries.map(entry => startOfDay(new Date(entry.at)).getTime()))
  const cursor = startOfDay(now)
  if (!days.has(cursor.getTime())) cursor.setDate(cursor.getDate() - 1)
  let streak = 0
  while (days.has(cursor.getTime())) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

// The most frequent first, with their count.
const ranking = <T,>(values: T[], keyOf: (value: T) => string) =>
  [
    ...values.reduce((counts, value) => {
      const key = keyOf(value)
      const entry = counts.get(key) ?? { value, count: 0 }
      entry.count++
      return counts.set(key, entry)
    }, new Map<string, { value: T; count: number }>())
  ]
    .map(([, entry]) => entry)
    .sort((a, b) => b.count - a.count)

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

const DayTooltip = ({ active, payload, unit }: { active?: boolean; payload?: { payload: Day }[]; unit: CountUnit }) => {
  const { t } = useTranslation()
  const day = payload?.[0]?.payload
  if (!active || !day) return null
  return (
    <span className={statStyles.tooltip}>
      {t('time.day', { weekday: day.short, numbers: day.date })} ·{' '}
      {t(`count.${unit}`, { count: day.count }).toUpperCase()}
    </span>
  )
}

const periodLabelOf = (t: TFunction, period: 7 | 30) => t(period === 7 ? 'stats.period.week' : 'stats.period.month')

interface DayChartProps {
  id: string
  // What the bars count.
  kind: Kind
  // "LU", "VUE": in the tooltip.
  unit: CountUnit
  entries: ReadingEntry[]
  period: 7 | 30
  now: Date
}

// Per day over the period, against the period before, with the daily average.
const DayChart = ({ id, kind, unit, entries, period, now }: DayChartProps) => {
  const { t } = useTranslation()
  const title = t(`stats.chart.${kind}`)
  const start = startOfDay(now).getTime() - (period - 1) * DAY_MS
  const inPeriod = entries.filter(entry => entry.at >= start).length
  const before = entries.filter(entry => entry.at >= start - period * DAY_MS && entry.at < start).length
  const days = daysOf(entries, period, now)
  const average = inPeriod / period
  const difference = inPeriod - before
  const max = Math.max(1, ...days.map(day => day.count))
  const periodLabel = periodLabelOf(t, period)

  return (
    <section className={statStyles.card} aria-labelledby={id}>
      <div className={statStyles.cardHead}>
        <div>
          <h2 id={id} className={statStyles.cardTitle}>
            {title}
          </h2>
          <p className={statStyles.cardIntro}>
            {t(`count.${kind}`, { count: inPeriod })} {periodLabel}
            {', '}
            {difference === 0 ? (
              t('stats.chart.same')
            ) : (
              <>
                <span className={difference > 0 ? statStyles.up : statStyles.down}>
                  {difference > 0 ? '+' : '−'}
                  {Math.abs(difference)}
                </span>{' '}
                {t('stats.chart.versus')}
              </>
            )}
          </p>
        </div>
        <span className={`${styles.mono} ${statStyles.legend}`}>
          <span className={statStyles.dash} aria-hidden="true" />
          {t('stats.chart.average', { value: average.toLocaleString(getLanguage(), { maximumFractionDigits: 1 }) })}
        </span>
      </div>
      <div className={statStyles.chart} role="img" aria-label={`${title}, ${periodLabel}`}>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={days} margin={{ top: 22, right: 0, bottom: 0, left: -24 }}>
            <YAxis
              ticks={[0, Math.ceil(max / 2), max]}
              domain={[0, max]}
              axisLine={false}
              tickLine={false}
              width={40}
            />
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
            <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={period === 7 ? 22 : 12} isAnimationActive={false}>
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
                      {day.count}
                    </text>
                  )
                }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}

interface StatsSectionProps {
  topics: TopicInfo[]
  layout: 'desktop' | 'phone'
}

// What was read and seen, on every device: the last 7 or 30 days, favourite topics and sources.
const StatsSection = ({ topics, layout }: StatsSectionProps) => {
  const { t } = useTranslation()
  const all: ReadingEntry[] = useSyncExternalStore(subscribeUserState, getReadings)
  const [period, setPeriod] = useState<7 | 30>(7)
  const [now] = useState(() => new Date())

  // Articles opened and left are only "survolés": the stats are about what was read.
  const opened = all.filter(entry => !isVideoReading(entry))
  const entries = opened.filter(isRead)
  // Videos and episodes opened and left early are only "survolées", as articles.
  const played = all.filter(isVideoReading)
  const videos = played.filter(isRead)
  const start = startOfDay(now).getTime() - (period - 1) * DAY_MS
  const inPeriod = entries.filter(entry => entry.at >= start)
  const articleSplit = splitOf(opened.filter(entry => entry.at >= start))
  // The time really spent, skimmed articles included.
  const minutes = opened.filter(entry => entry.at >= start).reduce((total, entry) => total + entry.minutes, 0)
  const playedInPeriod = played.filter(entry => entry.at >= start)
  const videoSplit = splitOf(playedInPeriod)
  // The time really played, skimmed videos included.
  const videoMinutes = playedInPeriod.reduce((total, entry) => total + entry.minutes, 0)

  const topicOf = (entry: ReadingEntry) =>
    topics.find(topic => topic.id === entry.topicId) ??
    topics.find(topic => topic.sources.some(source => source.id === entry.sourceId))
  const topTopics = ranking(
    inPeriod.flatMap(entry => {
      const topic = topicOf(entry)
      return topic ? [topic] : []
    }),
    topic => topic.id
  ).slice(0, TOP_ROWS)
  const topSources = ranking(inPeriod, entry => entry.sourceId).slice(0, TOP_ROWS)
  const topMax = Math.max(1, ...topTopics.map(row => row.count))

  const periodLabel = periodLabelOf(t, period)

  return (
    <SectionPage title={t('stats.title')} layout={layout} intro={t('stats.intro')}>
      <StatsHousehold />
      {/* The period only counts this profile's reading: beside its own title, under the household's week. */}
      <div className={statStyles.subtitle}>
        <h2 className={statStyles.subtitleText}>{t('stats.yours')}</h2>
        <Segmented
          label={t('stats.period.label')}
          value={period}
          onChange={setPeriod}
          options={[
            { value: 7, label: t('count.day', { count: 7 }) },
            { value: 30, label: t('count.day', { count: 30 }) }
          ]}
        />
      </div>
      <DaySeparator
        label={t('stats.articles')}
        count={articleSplit.read + articleSplit.started + articleSplit.skimmed}
        first
        still
        className={statStyles.separator}
      />
      <div className={`${statStyles.tiles} ${statStyles.four}`}>
        <span className={statStyles.tile}>
          <strong>{inPeriod.length}</strong>
          {t('stats.tiles.article.read', { count: inPeriod.length })}
        </span>
        <span className={statStyles.tile}>
          <strong>{articleSplit.skimmed}</strong>
          {t('stats.tiles.article.skimmed', { count: articleSplit.skimmed })}
        </span>
        <span className={statStyles.tile}>
          <strong>{durationLabel(minutes)}</strong>
          {t('stats.tiles.readingTime')}
        </span>
        <span className={statStyles.tile}>
          <strong>{streakOf(entries, now)}</strong>
          {t('stats.tiles.streak', { count: streakOf(entries, now) })}
        </span>
      </div>

      <ReadSplit split={articleSplit} kind="article" periodLabel={periodLabel} />

      <DayChart id="stats-days" kind="article" unit="read" entries={entries} period={period} now={now} />

      <DaySeparator
        label={t('nav.watch')}
        count={videoSplit.read + videoSplit.started + videoSplit.skimmed}
        unit="video"
        still
        className={statStyles.separator}
      />
      {/* The same four figures as the articles. */}
      <div className={`${statStyles.tiles} ${statStyles.four}`}>
        <span className={statStyles.tile}>
          <strong>{videoSplit.read}</strong>
          {t('stats.tiles.video.read', { count: videoSplit.read })}
        </span>
        <span className={statStyles.tile}>
          <strong>{videoSplit.skimmed}</strong>
          {t('stats.tiles.video.skimmed', { count: videoSplit.skimmed })}
        </span>
        <span className={statStyles.tile}>
          <strong>{durationLabel(videoMinutes)}</strong>
          {t('stats.tiles.watchTime')}
        </span>
        <span className={statStyles.tile}>
          <strong>{streakOf(videos, now)}</strong>
          {t('stats.tiles.streak', { count: streakOf(videos, now) })}
        </span>
      </div>

      <ReadSplit split={videoSplit} kind="video" periodLabel={periodLabel} />

      <DayChart id="stats-videos" kind="video" unit="view" entries={videos} period={period} now={now} />

      <DaySeparator label={t('stats.favourites')} still className={statStyles.separator} />
      <div className={statStyles.pair}>
        <section className={statStyles.card} aria-labelledby="stats-topics">
          <h2 id="stats-topics" className={statStyles.cardTitle}>
            {t('stats.topTopics')}
          </h2>
          {topTopics.length === 0 ? (
            <p className={styles.note}>{t('stats.nothing', { period: periodLabel })}</p>
          ) : (
            <ul className={statStyles.rows}>
              {topTopics.map(({ value: topic, count }) => (
                <li key={topic.id} className={statStyles.topicRow} data-topic={topic.id}>
                  <span className={statStyles.dot} aria-hidden="true" />
                  <span className={statStyles.rowName}>{topic.label}</span>
                  <span className={statStyles.track} aria-hidden="true">
                    <span className={statStyles.fill} style={{ width: `${(count / topMax) * 100}%` }} />
                  </span>
                  <span className={statStyles.count}>{count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className={statStyles.card} aria-labelledby="stats-sources">
          <h2 id="stats-sources" className={statStyles.cardTitle}>
            {t('stats.topSources')}
          </h2>
          {topSources.length === 0 ? (
            <p className={styles.note}>{t('stats.nothing', { period: periodLabel })}</p>
          ) : (
            <ul className={statStyles.rows}>
              {topSources.map(({ value: entry, count }) => (
                <li key={entry.sourceId} className={statStyles.sourceRow}>
                  <SourceAvatar sourceId={entry.sourceId} sourceName={entry.sourceName} size={22} />
                  <span className={statStyles.rowName}>{entry.sourceName}</span>
                  <span className={statStyles.count}>{count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </SectionPage>
  )
}

export default StatsSection
