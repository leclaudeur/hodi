import { AlertCircle, ArrowDown, Inbox, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TopicSummary } from '../api.ts'
import { usePullRefresh } from '../lib/pull-to-refresh.ts'
import { FRONT_PAGE_HREF } from '../lib/use-hash-route.ts'
import EmptyState from '../ui/EmptyState.tsx'
import Button from '../ui/Button.tsx'
import OfflineSaved from './OfflineSaved.tsx'
import PullIndicator from '../ui/PullIndicator.tsx'
import { ListSkeleton } from '../ui/Skeleton.tsx'
import ArticleList from './ArticleList.tsx'
import MobileFilterRow from './MobileFilterRow.tsx'
import MobilePage from './MobilePage.tsx'
import { useFeedView } from './use-feed-view.ts'

interface MobileTopicProps {
  topic: TopicSummary
  topics: TopicSummary[]
  onUnauthorized: () => void
}

// A topic on a phone: its days, the first article of each one large.
const MobileTopic = ({ topic, topics, onUnauthorized }: MobileTopicProps) => {
  const { t } = useTranslation()
  const feed = useFeedView(topic.id, onUnauthorized)
  const { pull, refreshing } = usePullRefresh(feed.refresh)

  return (
    <MobilePage
      title={topic.label}
      meta={feed.items.length > 0 ? t('count.article', { count: feed.items.length }) : undefined}
      backHref={FRONT_PAGE_HREF}
      busy={feed.waiting}
      top={
        <>
          <PullIndicator pull={pull} refreshing={refreshing} loadedAt={feed.loadedAt} />
          <MobileFilterRow topics={topics} selected={topic.id} />
        </>
      }
      footer={
        feed.previousDay &&
        !feed.failed && (
          <Button look="glass" onClick={feed.loadPrevious} busy={feed.loading} icon={ArrowDown}>
            {feed.loading && feed.groups.length > 0 ? t('common.loading') : feed.loadDayLabel(true)}
          </Button>
        )
      }
    >
      {feed.failed ? (
        <>
          <EmptyState
            compact
            tone="danger"
            icon={<AlertCircle size={28} />}
            title={t('feed.loadTopicFailed', { topic: topic.label })}
            actions={
              <Button look="primary" onClick={feed.refresh} icon={RefreshCw}>
                {t('common.retry')}
              </Button>
            }
          >
            {t('feed.savedOffline')}
          </EmptyState>
          <OfflineSaved />
        </>
      ) : feed.waiting ? (
        <ListSkeleton layout="phone" />
      ) : feed.groups.length > 0 ? (
        <ArticleList groups={feed.groups} layout="phone" />
      ) : (
        <EmptyState icon={<Inbox size={28} />} title={t(feed.allHidden ? 'feed.allRead' : 'feed.nothingNew')}>
          {t(feed.allHidden ? 'feed.allReadText' : 'feed.nothingInTopic')}
        </EmptyState>
      )}
    </MobilePage>
  )
}

export default MobileTopic
