import { AlertCircle, Inbox, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import Button from '../ui/Button.tsx'
import EmptyState from '../ui/EmptyState.tsx'
import OfflineSaved from './OfflineSaved.tsx'

interface FailedProps {
  title: string
  onRetry: () => void
}

// A phone's list that failed to load: a retry, then the saved articles this device can still open.
export const PhoneFeedFailed = ({ title, onRetry }: FailedProps) => {
  const { t } = useTranslation()
  return (
    <>
      <EmptyState
        compact
        tone="danger"
        icon={<AlertCircle size={28} />}
        title={title}
        actions={
          <Button look="primary" onClick={onRetry} icon={RefreshCw}>
            {t('common.retry')}
          </Button>
        }
      >
        {t('feed.savedOffline')}
      </EmptyState>
      <OfflineSaved />
    </>
  )
}

interface EmptyProps {
  // Every article was read or hidden, rather than none came in.
  allHidden: boolean
  // The line under the title when nothing came in, which says where to look instead.
  nothing: string
}

// A list with nothing left to show.
export const FeedEmpty = ({ allHidden, nothing }: EmptyProps) => {
  const { t } = useTranslation()
  return (
    <EmptyState icon={<Inbox size={28} />} title={t(allHidden ? 'feed.allRead' : 'feed.nothingNew')}>
      {allHidden ? t('feed.allReadText') : nothing}
    </EmptyState>
  )
}
