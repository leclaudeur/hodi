import { Clock } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type AccountView, changeAccountRegion } from '../../../api.ts'
import { timeZoneCity, timeZoneOffset } from '../../../lib/regions.ts'
import { showError, showSaved } from '../../../lib/toast.ts'
import { useIsPhone } from '../../../lib/use-media.ts'
import { TimeZonePicker } from '../../household/RegionPickers.tsx'
import SettingRow from '../SettingRow.tsx'
import styles from '../Settings.module.css'

// Réglages › Mon compte › Région: where the person's days start, wherever they read.
const RegionCard = ({ account, onAccount }: { account: AccountView; onAccount: (account: AccountView) => void }) => {
  const { t } = useTranslation()
  const phone = useIsPhone()
  const [picking, setPicking] = useState(false)
  const pick = (timeZone: string) =>
    changeAccountRegion({ timeZone }).then(
      next => {
        onAccount(next)
        showSaved()
      },
      () => showError(t('settings.account.regionFailed'))
    )
  return (
    <>
      <h2 className={styles.label}>{t('settings.account.region')}</h2>
      <div className={styles.card}>
        <SettingRow
          label={t('settings.account.timeZone')}
          value={t('settings.account.timeZoneValue', {
            zone: phone ? timeZoneCity(account.timeZone) : account.timeZone,
            offset: timeZoneOffset(account.timeZone)
          })}
          action={{ label: t('common.change'), icon: Clock, onClick: () => setPicking(true) }}
        />
      </div>
      <TimeZonePicker
        open={picking}
        value={account.timeZone}
        onPick={timeZone => void pick(timeZone)}
        onClose={() => setPicking(false)}
      />
    </>
  )
}

export default RegionCard
