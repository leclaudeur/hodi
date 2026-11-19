import { useTranslation } from 'react-i18next'
import type { AccountStats } from '../../../api.ts'
import styles from '../Settings.module.css'
import statStyles from './StatsSection.module.css'
import { durationLabel } from './StatsSection.tsx'

// Mon compte in no household: what the account read and earned. They are its own, in any household: in one, its
// profile's Statistiques show them.
const AccountStatsCard = ({ stats }: { stats: AccountStats }) => {
  const { t } = useTranslation()
  return (
    <>
      <h2 className={styles.label}>{t('stats.title')}</h2>
      <p className={styles.note}>{t('stats.account.intro')}</p>
      <div className={`${statStyles.tiles} ${statStyles.four}`}>
        <span className={statStyles.tile}>
          <strong>{stats.articles}</strong>
          {t('stats.account.articles', { count: stats.articles })}
        </span>
        <span className={statStyles.tile}>
          <strong>{stats.videos}</strong>
          {t('stats.account.videos', { count: stats.videos })}
        </span>
        <span className={statStyles.tile}>
          <strong>{durationLabel(stats.minutes)}</strong>
          {t('stats.tiles.readingTime')}
        </span>
        <span className={statStyles.tile}>
          <strong>{stats.points}</strong>
          {t('stats.account.points', { count: stats.points })}
        </span>
      </div>
    </>
  )
}

export default AccountStatsCard
