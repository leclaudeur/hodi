import { useTranslation } from 'react-i18next'
import { t } from '../../../lib/i18n.ts'
import { setOfflineReading, useKeptOffline, useOfflineReading } from '../../../lib/offline.ts'
import Chip from '../../../ui/Chip.tsx'
import Toggle from '../../../ui/Toggle.tsx'
import SectionPage from '../SectionPage.tsx'
import SettingRow from '../SettingRow.tsx'
import styles from '../Settings.module.css'

// "Mac · Safari", "iPhone · Hodi (PWA)": this device as the browser describes itself.
const thisDevice = () => {
  const agent = navigator.userAgent
  const device = /iPhone/.test(agent)
    ? 'iPhone'
    : /iPad/.test(agent)
      ? 'iPad'
      : /Android/.test(agent)
        ? 'Android'
        : /Mac/.test(agent)
          ? 'Mac'
          : /Windows/.test(agent)
            ? 'PC Windows'
            : 'Linux'
  const app = window.matchMedia('(display-mode: standalone)').matches
    ? 'Hodi (PWA)'
    : /Firefox\//.test(agent)
      ? 'Firefox'
      : /Edg\//.test(agent)
        ? 'Edge'
        : /Chrome\//.test(agent)
          ? 'Chrome'
          : /Safari\//.test(agent)
            ? 'Safari'
            : t('settings.account.browser')
  return { label: `${device} · ${app}` }
}

interface AccountSectionProps {
  layout: 'desktop' | 'phone'
}

// What this device keeps: its session and the articles read offline. Leaving is the menu's last line.
const AccountSection = ({ layout }: AccountSectionProps) => {
  const { t } = useTranslation()
  const device = thisDevice()
  const offline = useOfflineReading()
  const kept = useKeptOffline().size

  return (
    <SectionPage title={t('settings.nav.account')} intro={t('settings.account.intro')} layout={layout}>
      <h2 className={styles.label}>{t('settings.groups.device')}</h2>
      <div className={styles.card}>
        <SettingRow label={device.label} hint={t('settings.account.sessionHint')}>
          <Chip tone="accent" size="row">
            {t('settings.account.thisDevice')}
          </Chip>
        </SettingRow>
      </div>

      <h2 className={styles.label}>{t('settings.account.offline')}</h2>
      <div className={styles.card}>
        <SettingRow
          label={t('settings.account.offlineReading')}
          meta={kept > 0 ? t('settings.account.ready', { count: kept }) : undefined}
          hint={t('settings.account.offlineHint')}
        >
          <Toggle label={t('settings.account.offlineReading')} checked={offline} onChange={setOfflineReading} />
        </SettingRow>
      </div>
    </SectionPage>
  )
}

export default AccountSection
