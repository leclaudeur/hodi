import { WifiOff } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useConnection } from '../lib/connection.ts'
import { clockTime } from '../lib/format.ts'
import { useListedOffline } from '../lib/offline.ts'
import { useReadState } from '../lib/read-state.ts'
import styles from './OfflineBanner.module.css'

const hourOf = (at: number) => clockTime(at)

interface OfflineBannerProps {
  layout: 'desktop' | 'phone'
  onRetry: () => void
}

// Room the computer's toast takes at the bottom right: the other toasts stack above it (see ui/Toaster.tsx).
const ROOM = '--offline-toast'

// No network: what shows is the last copy kept on this device. On a computer, a toast that stays where the
// others show, under them; on a phone, a band at the top of the page.
const OfflineBanner = ({ layout, onRetry }: OfflineBannerProps) => {
  const { t } = useTranslation()
  const { online, lastUpdate } = useConnection()
  const listed = useListedOffline()
  // Read meanwhile: counted again.
  useReadState()
  const toast = !online && layout === 'desktop'

  useEffect(() => {
    if (!toast) return
    document.documentElement.style.setProperty(ROOM, '60px')
    return () => {
      document.documentElement.style.removeProperty(ROOM)
    }
  }, [toast])

  if (online) return null

  const unread = listed.length

  return (
    <div className={`${styles.banner} ${styles[layout]}`} role="status">
      <span className={styles.icon}>
        <WifiOff size={16} aria-hidden="true" />
      </span>
      <span className={styles.text}>
        {unread > 0 ? t('offline.withUnread', { count: unread }) : t('offline.title')}
        {layout === 'desktop' && lastUpdate !== null && (
          <span className={styles.since}>{t('offline.since', { time: hourOf(lastUpdate) })}</span>
        )}
      </span>
      <button type="button" className={styles.retry} onClick={onRetry}>
        {t('common.retry')}
      </button>
    </div>
  )
}

export default OfflineBanner
