import { useTranslation } from 'react-i18next'
import { Bar } from '../../../ui/Skeleton.tsx'
import SectionPage from '../SectionPage.tsx'
import statStyles from './StatsSection.module.css'
import styles from './StatsSkeleton.module.css'

// Heights of the chart's bars while it comes: a week that looks like one, not a flat line.
const BARS = [38, 62, 24, 80, 52, 70, 44]

// Four figures, for the articles as for the videos.
const Tiles = () => (
  <div className={`${statStyles.tiles} ${statStyles.four}`}>
    {[0, 1, 2, 3].map(tile => (
      <span key={tile} className={statStyles.tile}>
        <Bar width={56} height={40} radius={8} />
        <Bar width="70%" height={10} />
      </span>
    ))}
  </div>
)

// "Lus ou survolés": the title, its line, the bar and its legend.
const Split = () => (
  <div className={statStyles.card}>
    <Bar width={130} height={12} />
    <Bar width={240} height={10} />
    <Bar width="100%" height={10} radius={5} />
    <Bar width={260} height={10} />
  </div>
)

const Chart = () => (
  <div className={statStyles.card}>
    <Bar width={160} height={12} />
    <Bar width={220} height={10} />
    <div className={styles.bars}>
      {BARS.map((height, index) => (
        <Bar key={index} width="100%" height={(height / 100) * 180} radius={6} className={styles.bar} />
      ))}
    </div>
  </div>
)

// "Statistiques" while its chart library comes: the page's own shapes (figures, charts, top lists), not a
// list of articles.
const StatsSkeleton = ({ layout }: { layout: 'desktop' | 'phone' }) => {
  const { t } = useTranslation()
  return (
    <SectionPage title={t('settings.nav.stats')} layout={layout}>
      <div className={styles.skeleton} aria-busy="true" aria-label={t('stats.loading')}>
        <div className={statStyles.subtitle}>
          <Bar width={160} height={22} />
          <Bar width={156} height={36} radius={18} />
        </div>
        <Tiles />
        <Split />
        <Chart />
        <Tiles />
        <Split />
        <Chart />
      </div>
    </SectionPage>
  )
}

export default StatsSkeleton
