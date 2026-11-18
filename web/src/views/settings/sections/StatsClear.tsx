import { useTranslation } from 'react-i18next'
import { isYoung, useProfiles } from '../../../lib/profiles.ts'
import styles from '../Settings.module.css'
import ClearStatsRow from './ClearStatsRow.tsx'

// Under an adult's stats, the way to clear them; a young profile clears its own in Général.
const StatsClear = () => {
  const { t } = useTranslation()
  const value = useProfiles()
  const own = value?.profiles.find(profile => profile.id === value.current)
  if (!own || isYoung(own)) return null
  return (
    <>
      <h2 className={styles.label}>{t('settings.me.reset')}</h2>
      <div className={styles.card}>
        <ClearStatsRow />
      </div>
    </>
  )
}

export default StatsClear
