import { RefreshCw } from 'lucide-react'
import { PULL_THRESHOLD } from '../lib/pull-to-refresh.ts'
import { timeAgo } from '../lib/format.ts'
import styles from './PullIndicator.module.css'
import { useTranslation } from 'react-i18next'

// The band that opens under the header while pulling a list down, from the charter's "Tirer pour actualiser".
const HEIGHT = 76

interface PullIndicatorProps {
  pull: number
  refreshing: boolean
  // When the list was last fetched: "UPDATED 12 MIN AGO".
  loadedAt: number
}

const PullIndicator = ({ pull, refreshing, loadedAt }: PullIndicatorProps) => {
  const { t } = useTranslation()
  if (pull === 0 && !refreshing) return null

  const ready = pull >= PULL_THRESHOLD
  const label = t(refreshing ? 'pull.refreshing' : ready ? 'pull.release' : 'pull.pull')
  const age = loadedAt > 0 ? timeAgo(new Date(loadedAt).toISOString())?.toUpperCase() : null

  return (
    <div
      className={styles.band}
      style={{ height: refreshing ? HEIGHT : Math.min(HEIGHT, (pull / PULL_THRESHOLD) * HEIGHT) }}
      role="status"
    >
      <span
        className={`${styles.icon} ${refreshing ? styles.spinning : ''}`}
        style={refreshing ? undefined : { transform: `rotate(${Math.min(1, pull / PULL_THRESHOLD) * 180}deg)` }}
        aria-hidden="true"
      >
        <RefreshCw size={16} />
      </span>
      <span className={styles.label}>
        {label}
        {age && !refreshing && ` · ${t('pull.updated', { age })}`}
      </span>
    </div>
  )
}

export default PullIndicator
