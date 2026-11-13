import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type ServerOverview as Overview, type TopicInfo, getServerOverview, getTopics } from '../../api.ts'
import SectionPage from '../settings/SectionPage.tsx'
import settingStyles from '../settings/Settings.module.css'
import ActivityChart from './overview/ActivityChart.tsx'
import HealthCard from './overview/HealthCard.tsx'
import KpiCard from './overview/KpiCard.tsx'
import { METRICS, type MetricId, sum } from './overview/metrics.ts'
import OnlineCard from './overview/OnlineCard.tsx'
import PluginCards from './overview/PluginCards.tsx'
import PeriodPicker, { type Period } from './overview/PeriodPicker.tsx'
import ProfilesCard from './overview/ProfilesCard.tsx'
import { SourcesCard, TopicsCard } from './overview/ReadsCards.tsx'
import styles from './overview/Overview.module.css'

// The server's totals for the period, and the topics' names and colours.
const useOverview = (period: Period) => {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [topics, setTopics] = useState<TopicInfo[]>([])
  useEffect(() => {
    let current = true
    getServerOverview(period)
      .then(next => current && setOverview(next))
      .catch(() => {})
    return () => {
      current = false
    }
  }, [period])
  useEffect(() => {
    getTopics()
      .then(setTopics)
      .catch(() => {})
  }, [])
  return { overview, topics }
}

// The figures, the chosen one day by day, who is online and the profiles, what is read, and the server's health.
const Board = ({ overview, topics, span }: { overview: Overview; topics: TopicInfo[]; span: number }) => {
  const [chosen, setChosen] = useState<MetricId>('articles')
  const { days, previous } = overview
  return (
    <div className={styles.board}>
      <div className={styles.kpis}>
        {METRICS.map(metric => (
          <KpiCard
            key={metric.id}
            metric={metric}
            days={days}
            previous={previous}
            chosen={metric.id === chosen}
            onChoose={() => setChosen(metric.id)}
          />
        ))}
      </div>
      <ActivityChart
        metric={METRICS.find(metric => metric.id === chosen) ?? METRICS[0]!}
        days={days}
        previous={previous}
        span={span}
      />
      <div className={styles.side}>
        <OnlineCard online={overview.online} households={overview.households} />
        <ProfilesCard profiles={overview.profiles} added={sum(days, day => day.profiles)} span={span} />
      </div>
      <PluginCards days={days} />
      <TopicsCard read={overview.topics} topics={topics} />
      <SourcesCard read={overview.sources} />
      <HealthCard />
    </div>
  )
}

// Serveur › Vue d'ensemble: the whole server at a glance, on the whole width. Totals only: never what one person
// read.
const ServerOverview = ({ layout }: { layout: 'desktop' | 'phone' }) => {
  const { t } = useTranslation()
  const [period, setPeriod] = useState<Period>({ days: 7 })
  const { overview, topics } = useOverview(period)
  const title = t('server.titles.overview')
  const intro = t((overview?.households ?? 1) > 1 ? 'server.overview.introSeveral' : 'server.overview.introOne')
  const periods = <PeriodPicker period={period} onChange={setPeriod} />
  // Chosen dates count as their number of days: « +3 en 12 jours ».
  const span = 'days' in period ? period.days : (overview?.days.length ?? 0)
  const board = overview && <Board overview={overview} topics={topics} span={span} />
  if (layout === 'phone')
    return (
      <SectionPage title={title} aside={periods} layout="phone">
        {board}
      </SectionPage>
    )
  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div>
          <h1 className={`${settingStyles.title} screen-title`}>{title}</h1>
          <p className={settingStyles.intro}>{intro}</p>
        </div>
        {periods}
      </div>
      {board}
    </div>
  )
}

export default ServerOverview
