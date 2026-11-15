import { ArrowDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TopicSummary } from '../api.ts'
import { usePullRefresh } from '../lib/pull-to-refresh.ts'
import { FRONT_PAGE_HREF } from '../lib/use-hash-route.ts'
import Button from '../ui/Button.tsx'
import PullIndicator from '../ui/PullIndicator.tsx'
import { ListSkeleton } from '../ui/Skeleton.tsx'
import ArticleList from './ArticleList.tsx'
import { FeedEmpty, PhoneFeedFailed } from './FeedStates.tsx'
import MobileFilterRow from './MobileFilterRow.tsx'
import MobilePage from './MobilePage.tsx'
import { useFeedView } from './use-feed-view.ts'

type FeedView = ReturnType<typeof useFeedView>

interface MobileTopicProps {
  topic: TopicSummary
  topics: TopicSummary[]
  onUnauthorized: () => void
}

// A topic's days once they loaded or while they load.
const TopicBody = ({ feed }: { feed: FeedView }) => {
  const { t } = useTranslation()
  if (feed.waiting) return <ListSkeleton layout="phone" />
  if (feed.groups.length > 0) return <ArticleList groups={feed.groups} layout="phone" />
  return <FeedEmpty allHidden={feed.allHidden} nothing={t('feed.nothingInTopic')} />
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
        <PhoneFeedFailed title={t('feed.loadTopicFailed', { topic: topic.label })} onRetry={feed.refresh} />
      ) : (
        <TopicBody feed={feed} />
      )}
    </MobilePage>
  )
}

export default MobileTopic
