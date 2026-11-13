import { useTranslation } from 'react-i18next'
import type { TopicInfo } from '../../../api.ts'
import type { ReadingEntry } from '../../../lib/reading-stats.ts'
import SourceAvatar from '../../../ui/SourceAvatar.tsx'
import styles from '../Settings.module.css'
import statStyles from './StatsSection.module.css'

const TOP_ROWS = 4

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

interface FavouritesProps {
  // What was read in the period.
  entries: ReadingEntry[]
  topics: TopicInfo[]
  periodLabel: string
}

// The topics and sources read most in the period, side by side.
const StatsFavourites = ({ entries, topics, periodLabel }: FavouritesProps) => {
  const { t } = useTranslation()
  const topicOf = (entry: ReadingEntry) =>
    topics.find(topic => topic.id === entry.topicId) ??
    topics.find(topic => topic.sources.some(source => source.id === entry.sourceId))
  const topTopics = ranking(
    entries.flatMap(entry => {
      const topic = topicOf(entry)
      return topic ? [topic] : []
    }),
    topic => topic.id
  ).slice(0, TOP_ROWS)
  const topSources = ranking(entries, entry => entry.sourceId).slice(0, TOP_ROWS)
  const topMax = Math.max(1, ...topTopics.map(row => row.count))
  const nothing = <p className={styles.note}>{t('stats.nothing', { period: periodLabel })}</p>

  return (
    <div className={statStyles.pair}>
      <section className={statStyles.card} aria-labelledby="stats-topics">
        <h2 id="stats-topics" className={statStyles.cardTitle}>
          {t('stats.topTopics')}
        </h2>
        {topTopics.length === 0 ? (
          nothing
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
          nothing
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
  )
}

export default StatsFavourites
