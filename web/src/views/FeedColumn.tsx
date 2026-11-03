import { AlertCircle, ArrowDown, Bookmark, Inbox, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import PageHelp from '../ui/PageHelp.tsx'
import HelpButton from '../ui/HelpButton.tsx'
import { useResume } from '../lib/resume.ts'
import { todayLabel } from '../lib/format.ts'
import { useFrontPage, useFrontPageSettled } from '../lib/front-page.ts'
import { SAVED_HREF } from '../lib/use-hash-route.ts'
import EmptyState from '../ui/EmptyState.tsx'
import Button from '../ui/Button.tsx'
import { ListSkeleton } from '../ui/Skeleton.tsx'
import ArticleList from './ArticleList.tsx'
import ListColumn from './ListColumn.tsx'
import ResumePile from './ResumePile.tsx'
import StoriesRow, { StoriesRowSkeleton } from './StoriesRow.tsx'
import { useFeedView } from './use-feed-view.ts'

interface FeedColumnProps {
  // A topic's id, or null for Le fil (every topic).
  topicId: string | null
  title: string
  // The article open in the reader.
  activeId: string | null
  onUnauthorized: () => void
}

// The desktop list of Le fil or of a topic: one day at a time, "Charger <jour>" for the one before.
const FeedColumn = ({ topicId, title, activeId, onUnauthorized }: FeedColumnProps) => {
  const feed = useFeedView(topicId ?? '', onUnauthorized)
  const sections = useFrontPage()
  const frontPageSettled = useFrontPageSettled()
  const isFeed = topicId === null
  const resumeReady = useResume(onUnauthorized, isFeed)
  const { t } = useTranslation()

  const footer = feed.previousDay && !feed.failed && (
    <Button wide onClick={feed.loadPrevious} busy={feed.loading} icon={ArrowDown}>
      {feed.loading && feed.groups.length > 0 ? t('common.loading') : feed.loadDayLabel()}
    </Button>
  )

  return (
    <ListColumn
      title={title}
      meta={isFeed ? todayLabel() : feed.meta}
      footer={footer || undefined}
      busy={feed.waiting}
      help={
        isFeed && (
          <HelpButton id="feed" title={t('help.feed.title')} layout="desktop">
            <PageHelp page="feed" layout="desktop" />
          </HelpButton>
        )
      }
      pinned={
        isFeed &&
        !feed.failed &&
        (sections ? (
          <StoriesRow sections={sections} layout="desktop" />
        ) : (
          !frontPageSettled && <StoriesRowSkeleton layout="desktop" />
        ))
      }
    >
      {feed.failed ? (
        <EmptyState
          tone="danger"
          icon={<AlertCircle size={28} />}
          title={isFeed ? t('feed.loadFailed') : t('feed.loadTopicFailed', { topic: title })}
          actions={
            <>
              <Button look="primary" onClick={feed.refresh} icon={RefreshCw}>
                {t('common.retry')}
              </Button>
              <Button onClick={() => (window.location.hash = SAVED_HREF)} icon={Bookmark}>
                {t('nav.saved')}
              </Button>
            </>
          }
        >
          {t('feed.savedOffline')}
        </EmptyState>
      ) : feed.waiting || (isFeed && (!resumeReady || !frontPageSettled)) ? (
        <ListSkeleton />
      ) : feed.groups.length > 0 ? (
        <>
          {isFeed && <ResumePile layout="desktop" activeId={activeId} />}
          <ArticleList groups={feed.groups} layout="desktop" activeId={activeId} />
        </>
      ) : (
        <EmptyState icon={<Inbox size={28} />} title={t(feed.allHidden ? 'feed.allRead' : 'feed.nothingNew')}>
          {t(feed.allHidden ? 'feed.allReadText' : 'feed.nothingNewDesktop')}
        </EmptyState>
      )}
    </ListColumn>
  )
}

export default FeedColumn
