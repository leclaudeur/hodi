import { useTranslation } from 'react-i18next'
import Logo from './Logo.tsx'
import styles from './LoadingScreen.module.css'

// What the app shows while it waits for the server (the session, a profile's limits, the plugins): the logo, its dot
// breathing, so a slow answer never reads as a blank, broken page. Nothing for the first 300 ms, so a quick one never
// flashes.
const LoadingScreen = () => {
  const { t } = useTranslation()
  return (
    <div className={styles.screen} role="status" aria-label={t('common.loading')}>
      <Logo size={48} breathing className={styles.logo} />
    </div>
  )
}

export default LoadingScreen
