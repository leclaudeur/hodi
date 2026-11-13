import type { TFunction } from 'i18next'
import { CirclePlay, Newspaper } from 'lucide-react'
import { type ReactNode, Suspense, lazy } from 'react'
import type { TopicInfo } from '../api.ts'
import type { Route } from '../lib/use-hash-route.ts'
import EmptyState from '../ui/EmptyState.tsx'
import PanePlaceholder from '../ui/PanePlaceholder.tsx'
import DailySummaryStory from '../views/DailySummaryStory.tsx'
import FeedColumn from '../views/FeedColumn.tsx'
import columnStyles from '../views/ListColumn.module.css'
import FollowedScreen from '../views/FollowedScreen.tsx'
import SharesScreen from '../views/SharesScreen.tsx'
import HistoryScreen from '../views/HistoryScreen.tsx'
import MobileHome from '../views/MobileHome.tsx'
import MobileTopic from '../views/MobileTopic.tsx'
import NotFound from '../views/NotFound.tsx'
import SavedScreen from '../views/SavedScreen.tsx'
import StoryViewer from '../views/StoryViewer.tsx'
import Reader from '../views/reader/Reader.tsx'
import SearchScreen, { SearchPlaceholder, closeSearch } from '../views/search/SearchScreen.tsx'
import SettingsNav from '../views/settings/SettingsNav.tsx'
import WatchList from '../views/watch/WatchList.tsx'
import WatchPanel from '../views/watch/WatchPanel.tsx'
import type { List } from './home-routes.ts'
import { loadSettingsPanel } from './settings-loader.ts'

const SettingsPanel = lazy(loadSettingsPanel)

// What every part of the home page draws from. Plain functions below rather than components: the page's tree stays
// exactly what one component drew.
export interface Home {
  route: Route
  list: List | null
  // The topics shown, in the settings' order; allTopics: every one, null while they load.
  topics: TopicInfo[] | null
  allTopics: TopicInfo[] | null
  error: boolean
  readerId: string | null
  isDesktop: boolean
  isTablet: boolean
  onUnauthorized: () => void
  onLogout: () => Promise<void>
  onBack: () => void
  onWatchBack: () => void
  t: TFunction
}

const topicOf = (home: Home, topicId: string) => home.allTopics?.find(topic => topic.id === topicId)

const topicsFailed = (t: TFunction) => (
  <EmptyState tone="danger" icon={<Newspaper size={28} />} title={t('feed.topicsFailed')}>
    {t('common.tryAgainSoon')}
  </EmptyState>
)

// The pages that are not lists yet look the same on both layouts (they get their own design later).
export const detailOf = (home: Home): ReactNode => {
  const { route, readerId, isDesktop, isTablet, onUnauthorized } = home
  if (readerId) {
    return (
      <Reader
        key={readerId}
        articleId={readerId}
        layout={isDesktop || isTablet ? 'desktop' : 'phone'}
        withBack={isTablet}
        onBack={home.onBack}
        onUnauthorized={onUnauthorized}
      />
    )
  }
  if (route.name === 'listen' && route.itemId) {
    return (
      <WatchPanel
        key={route.itemId}
        itemId={route.itemId}
        layout={isDesktop ? 'desktop' : 'phone'}
        onBack={home.onWatchBack}
        onUnauthorized={onUnauthorized}
      />
    )
  }
  if (route.name === 'search' && isDesktop) return <SearchPlaceholder />
  if (route.name === 'settings' && (isDesktop || route.section)) {
    return (
      <Suspense>
        <SettingsPanel
          section={route.section ?? 'reading'}
          item={route.item}
          topics={home.allTopics}
          layout={isDesktop ? 'desktop' : 'phone'}
          onUnauthorized={onUnauthorized}
        />
      </Suspense>
    )
  }
  return null
}

// A computer's list column: the list chosen, the videos or the settings' sections.
export const columnOf = (home: Home): ReactNode => {
  const { route, list, readerId: activeId, onUnauthorized, t } = home
  const topics = home.topics ?? []
  if (list?.name === 'saved') return <SavedScreen layout="desktop" topics={topics} activeId={activeId} />
  if (list?.name === 'followed')
    return <FollowedScreen layout="desktop" activeId={activeId} onUnauthorized={onUnauthorized} />
  if (list?.name === 'shares')
    return <SharesScreen layout="desktop" activeId={activeId} onUnauthorized={onUnauthorized} />
  if (list?.name === 'history')
    return <HistoryScreen layout="desktop" topics={topics} activeId={activeId} onUnauthorized={onUnauthorized} />
  if (route.name === 'listen')
    return <WatchList layout="desktop" activeId={route.itemId} onUnauthorized={onUnauthorized} />
  if (route.name === 'settings') {
    return (
      <SettingsNav
        layout="desktop"
        active={route.section ?? 'reading'}
        activeItem={route.item}
        onLogout={home.onLogout}
        onUnauthorized={onUnauthorized}
      />
    )
  }
  if (list?.name === 'search') {
    return (
      <SearchScreen
        layout="desktop"
        initialQuery={route.name === 'search' ? route.query : ''}
        topics={topics}
        activeId={activeId}
        onUnauthorized={onUnauthorized}
      />
    )
  }
  if (list?.topicId) {
    const topic = topicOf(home, list.topicId)
    if (topic) {
      return (
        <FeedColumn
          key={topic.id}
          topicId={topic.id}
          title={topic.label}
          activeId={activeId}
          onUnauthorized={onUnauthorized}
        />
      )
    }
    // The column's place while the topics load, so the page beside it does not jump sideways.
    return home.allTopics === null && <div className={columnStyles.column} aria-hidden="true" />
  }
  return (
    list && <FeedColumn topicId={null} title={t('feed.title')} activeId={activeId} onUnauthorized={onUnauthorized} />
  )
}

// A computer's panel: a story, the page open, or what to pick when there is none.
export const paneOf = (home: Home, page: ReactNode): ReactNode => {
  const { route, list, t } = home
  if (route.name === 'story') return <StoryViewer topicId={route.topicId} layout="desktop" />
  if (route.name === 'dailySummary') return <DailySummaryStory layout="desktop" onUnauthorized={home.onUnauthorized} />
  if (page !== null) return page
  if (home.error) return topicsFailed(t)
  const unknownTopic =
    list?.name === 'feed' && list.topicId !== null && home.allTopics !== null && !topicOf(home, list.topicId)
  if (unknownTopic) return <NotFound />
  if (route.name === 'listen') {
    return (
      <PanePlaceholder icon={<CirclePlay size={20} />} title={t('pane.video')}>
        {t('pane.videoText')}
      </PanePlaceholder>
    )
  }
  return (
    <PanePlaceholder icon={<Newspaper size={20} />} title={t('pane.article')}>
      {t('pane.articleText')}
    </PanePlaceholder>
  )
}

const topicScreen = (home: Home, topicId: string): ReactNode => {
  const topic = topicOf(home, topicId)
  if (topic)
    return <MobileTopic key={topic.id} topic={topic} topics={home.topics ?? []} onUnauthorized={home.onUnauthorized} />
  if (home.error) return topicsFailed(home.t)
  return home.allTopics && <NotFound />
}

// A phone's screen, and a tablet's panel: the phone's screens, or the page open.
export const screenOf = (home: Home, page: ReactNode): ReactNode => {
  const { route, onUnauthorized } = home
  const topics = home.topics ?? []
  if (route.name === 'frontPage' || route.name === 'story' || route.name === 'dailySummary')
    return <MobileHome topics={home.error ? [] : home.topics} onUnauthorized={onUnauthorized} />
  if (route.name === 'topic') return topicScreen(home, route.topicId)
  if (route.name === 'saved') return <SavedScreen layout="phone" topics={topics} />
  if (route.name === 'followed') return <FollowedScreen layout="phone" onUnauthorized={onUnauthorized} />
  if (route.name === 'shares') return <SharesScreen layout="phone" onUnauthorized={onUnauthorized} />
  if (route.name === 'history') return <HistoryScreen layout="phone" topics={topics} onUnauthorized={onUnauthorized} />
  if (route.name === 'listen' && !route.itemId) return <WatchList layout="phone" onUnauthorized={onUnauthorized} />
  if (route.name === 'settings' && !route.section)
    return <SettingsNav layout="phone" active={null} onLogout={home.onLogout} onUnauthorized={onUnauthorized} />
  if (route.name === 'search') {
    return (
      <SearchScreen
        layout="phone"
        initialQuery={route.query}
        topics={topics}
        onClose={closeSearch}
        onUnauthorized={onUnauthorized}
      />
    )
  }
  return page
}
