import { useState, useSyncExternalStore } from 'react'
import { type TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import type { TopicInfo } from '../../../api.ts'
import { type ReadingEntry, getReadings, isRead, isVideoReading, startOfDay } from '../../../lib/reading-stats.ts'
import { getLanguage } from '../../../lib/i18n.ts'
import { subscribeUserState } from '../../../lib/user-state.ts'
import Segmented from '../../../ui/Segmented.tsx'
import DaySeparator, { type CountUnit } from '../../../ui/DaySeparator.tsx'
import SectionPage from '../SectionPage.tsx'
import DayBars, { type Day } from './DayBars.tsx'
import StatsFavourites from './StatsFavourites.tsx'
import StatsHousehold from './StatsHousehold.tsx'
import styles from '../Settings.module.css'
import statStyles from './StatsSection.module.css'
import { DAY_MS } from '../../../../../shared/time.ts'

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
      <DayBars
        days={days}
        average={average}
        unit={count => t(`count.${unit}`, { count })}
        label={`${title}, ${periodLabel}`}
      />
    </section>
  )
}

interface StatTilesProps {
  kind: Kind
  read: number
  skimmed: number
  duration: string
  timeLabel: string
  streak: number
}

// Four figures: read (or seen), skimmed, the time spent, and the days in a row.
const StatTiles = ({ kind, read, skimmed, duration, timeLabel, streak }: StatTilesProps) => {
  const { t } = useTranslation()
  return (
    <div className={`${statStyles.tiles} ${statStyles.four}`}>
      <span className={statStyles.tile}>
        <strong>{read}</strong>
        {t(`stats.tiles.${kind}.read`, { count: read })}
      </span>
      <span className={statStyles.tile}>
        <strong>{skimmed}</strong>
        {t(`stats.tiles.${kind}.skimmed`, { count: skimmed })}
      </span>
      <span className={statStyles.tile}>
        <strong>{duration}</strong>
        {timeLabel}
      </span>
      <span className={statStyles.tile}>
        <strong>{streak}</strong>
        {t('stats.tiles.streak', { count: streak })}
      </span>
    </div>
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
      <StatTiles
        kind="article"
        read={inPeriod.length}
        skimmed={articleSplit.skimmed}
        duration={durationLabel(minutes)}
        timeLabel={t('stats.tiles.readingTime')}
        streak={streakOf(entries, now)}
      />

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
      <StatTiles
        kind="video"
        read={videoSplit.read}
        skimmed={videoSplit.skimmed}
        duration={durationLabel(videoMinutes)}
        timeLabel={t('stats.tiles.watchTime')}
        streak={streakOf(videos, now)}
      />

      <ReadSplit split={videoSplit} kind="video" periodLabel={periodLabel} />

      <DayChart id="stats-videos" kind="video" unit="view" entries={videos} period={period} now={now} />

      <DaySeparator label={t('stats.favourites')} still className={statStyles.separator} />
      <StatsFavourites entries={inPeriod} topics={topics} periodLabel={periodLabel} />
    </SectionPage>
  )
}

export default StatsSection
