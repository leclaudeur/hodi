import { useTranslation } from 'react-i18next'
import type { YouthWeek } from '../../../../api.ts'
import TopicCapsule from '../../../../ui/TopicCapsule.tsx'
import { formatMinutes } from './format.ts'
import styles from './Young.module.css'

interface WeekDialogProps {
  week: YouthWeek
  // The themes' names, by id.
  labels: Map<string, string>
  // Its colour, for the bars.
  color: string
}

// "Sa semaine": seven bars of time on screen, today last, then what it read and its themes. Never a title: its
// parents see how much, not what.
const WeekDialog = ({ week, labels, color }: WeekDialogProps) => {
  const { t, i18n } = useTranslation()
  const longest = Math.max(...week.days.map(day => day.seconds), 1)
  const total = Math.round(week.days.reduce((sum, day) => sum + day.seconds, 0) / 60)
  const weekday = new Intl.DateTimeFormat(i18n.language, { weekday: 'short', timeZone: 'UTC' })

  return (
    <div className={`${styles.scroll} ${styles.scrollToEnd}`}>
      <div className={styles.bars} data-topic={color} role="img" aria-label={t('young.weekTime')}>
        {week.days.map((day, index) => (
          <div
            key={day.day}
            className={`${styles.bar} ${index === week.days.length - 1 ? styles.today : ''}`}
            title={formatMinutes(Math.round(day.seconds / 60))}
          >
            <span className={styles.barFill} style={{ height: `${(day.seconds / longest) * 100}%` }} />
            <span className={styles.barDay}>{weekday.format(new Date(`${day.day}T12:00:00Z`)).replace('.', '')}</span>
          </div>
        ))}
      </div>
      <div className={styles.totals}>
        <div className={styles.total}>
          <span className={styles.totalValue}>{formatMinutes(total)}</span>
          <span className={styles.totalLabel}>{t('young.weekTime')}</span>
        </div>
        <div className={styles.total}>
          <span className={styles.totalValue}>{week.articles}</span>
          <span className={styles.totalLabel}>
            {t('count.article', { count: week.articles }).replace(/^\d+\s*/, '')}
          </span>
        </div>
        <div className={styles.total}>
          <span className={styles.totalValue}>{week.videos}</span>
          <span className={styles.totalLabel}>{t('count.video', { count: week.videos }).replace(/^\d+\s*/, '')}</span>
        </div>
      </div>
      <h3 className={styles.group}>{t('young.weekThemes')}</h3>
      {week.topics.length === 0 ? (
        <p className={styles.intro}>{t('young.weekThemesNone')}</p>
      ) : (
        <ul className={styles.themes}>
          {week.topics.map(topic => (
            <li key={topic.id}>
              <TopicCapsule
                topicId={topic.id}
                label={`${labels.get(topic.id) ?? topic.id} · ${topic.count}`}
                href={null}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default WeekDialog
