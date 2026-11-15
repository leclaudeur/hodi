import { useTranslation } from 'react-i18next'
import type { ServerOverview, TopicInfo } from '../../../api.ts'
import { getLanguage } from '../../../lib/i18n.ts'
import SourceAvatar from '../../../ui/SourceAvatar.tsx'
import styles from './OverviewCards.module.css'
import board from './Overview.module.css'

const Head = ({ id, title, caption }: { id: string; title: string; caption: string }) => (
  <div className={board.cardHead}>
    <h2 id={id} className={board.cardTitle}>
      {title}
    </h2>
    <span className={board.label}>{caption}</span>
  </div>
)

// Every topic read in the period, as a share of the reading: one bar split by topic, then the list, which scrolls.
export const TopicsCard = ({ read, topics }: { read: ServerOverview['topics']; topics: TopicInfo[] }) => {
  const { t } = useTranslation()
  const total = Math.max(
    1,
    read.reduce((all, topic) => all + topic.count, 0)
  )
  return (
    <section className={`${board.card} ${board.third}`} aria-labelledby="overview-topics">
      <Head id="overview-topics" title={t('server.overview.top.topics')} caption={t('server.overview.top.share')} />
      {read.length ? (
        <>
          <div className={styles.share} aria-hidden="true">
            {read.map(topic => (
              <span key={topic.id} data-topic={topic.id} style={{ flex: topic.count }} />
            ))}
          </div>
          <ul className={styles.list}>
            {read.map(topic => (
              <li key={topic.id} data-topic={topic.id}>
                <i />
                <span>{topics.find(entry => entry.id === topic.id)?.label ?? topic.id}</span>
                <b>{Math.round((topic.count / total) * 100).toLocaleString(getLanguage())} %</b>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className={styles.nobody}>{t('server.overview.nothing')}</p>
      )}
    </section>
  )
}

// Every source read in the period, its articles as a bar behind its name.
export const SourcesCard = ({ read }: { read: ServerOverview['sources'] }) => {
  const { t } = useTranslation()
  const max = Math.max(1, ...read.map(source => source.count))
  return (
    <section className={`${board.card} ${board.third}`} aria-labelledby="overview-sources">
      <Head id="overview-sources" title={t('server.overview.top.sources')} caption={t('server.overview.top.read')} />
      {read.length ? (
        <ul className={styles.bars}>
          {read.map(source => (
            <li key={source.id}>
              <span className={styles.barFill} style={{ width: `${(source.count / max) * 100}%` }} />
              <SourceAvatar sourceId={source.id} sourceName={source.name} size={20} />
              <span className={styles.barName}>{source.name}</span>
              <b>{source.count.toLocaleString(getLanguage())}</b>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.nobody}>{t('server.overview.nothing')}</p>
      )}
    </section>
  )
}
