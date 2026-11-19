import { useTranslation } from 'react-i18next'
import type { KeptStats } from '../../../api.ts'
import styles from '../Settings.module.css'
import statStyles from './StatsSection.module.css'
import { durationLabel } from './StatsSection.tsx'

// Mon compte in no household: what the account read and earned in the household it left. They are its own, and come
// back on its profile when it joins another household.
const KeptStatsCard = ({ kept }: { kept: KeptStats }) => {
  const { t } = useTranslation()
  return (
    <>
      <h2 className={styles.label}>{t('stats.title')}</h2>
      <p className={styles.note}>{t('stats.kept.intro')}</p>
      <div className={`${statStyles.tiles} ${statStyles.four}`}>
        <span className={statStyles.tile}>
          <strong>{kept.articles}</strong>
          {t('stats.kept.articles', { count: kept.articles })}
        </span>
        <span className={statStyles.tile}>
          <strong>{kept.videos}</strong>
          {t('stats.kept.videos', { count: kept.videos })}
        </span>
        <span className={statStyles.tile}>
          <strong>{durationLabel(kept.minutes)}</strong>
          {t('stats.tiles.readingTime')}
        </span>
        <span className={statStyles.tile}>
          <strong>{kept.points}</strong>
          {t('stats.kept.points', { count: kept.points })}
        </span>
      </div>
    </>
  )
}

export default KeptStatsCard
