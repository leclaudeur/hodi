import { useTranslation } from 'react-i18next'
import { CirclePlay, Newspaper } from 'lucide-react'
import { type ReactNode, type TouchEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { TOPICS_CHANGED, type TopicInfo, UnauthorizedError, getTopics, logout } from '../api.ts'
import MobileNav from '../app/MobileNav.tsx'
import ShortcutsHelp from '../app/ShortcutsHelp.tsx'
import Sidebar from '../app/Sidebar.tsx'
import type { Section } from '../app/nav.ts'
import { refreshDayFeed } from '../lib/day-feed.ts'
import { useLanguage } from '../lib/i18n.ts'
import { useKeyboardShortcuts } from '../lib/keyboard-shortcuts.ts'
import { refreshListen } from '../lib/listen.ts'
import { useNotificationSync } from '../lib/notifications.ts'
import { hasShownSource, orderTopics, usePreferences } from '../lib/preferences.ts'
import { useTheme } from '../lib/theme.ts'
import { useFadeIn } from '../lib/use-fade-in.ts'
import {
  CLOSE_READER,
  FRONT_PAGE_HREF,
  LISTEN_HREF,
  type Route,
  topicHref,
  useHashRoute
} from '../lib/use-hash-route.ts'
import { useIsDesktop, useIsTabletAcross } from '../lib/use-media.ts'
import { sendPendingChanges, startUserStateSync } from '../lib/user-state.ts'
import EmptyState from '../ui/EmptyState.tsx'
import OfflineBanner from '../ui/OfflineBanner.tsx'
import PanePlaceholder from '../ui/PanePlaceholder.tsx'
import ScrollArea from '../ui/ScrollArea.tsx'
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
import SettingsPanel from '../views/settings/SettingsPanel.tsx'
import WatchList from '../views/watch/WatchList.tsx'
import WatchPanel from '../views/watch/WatchPanel.tsx'
import styles from './HomePage.module.css'

// The lists an article can be opened from: Le fil (topicId null), a topic, the saved or followed articles, a search,
// the history.
type List =
  | { name: 'feed'; topicId: string | null }
  | { name: 'saved' }
  | { name: 'followed' }
  | { name: 'shares' }
  | { name: 'search' }
  | { name: 'history' }

const FEED: List = { name: 'feed', topicId: null }

const listOf = (route: Route): List | null => {
  switch (route.name) {
    case 'frontPage':
    case 'story':
    case 'dailySummary':
      return FEED
    case 'topic':
      return { name: 'feed', topicId: route.topicId }
    case 'saved':
    case 'followed':
    case 'shares':
    case 'search':
    case 'history':
      return { name: route.name }
    default:
      return null
  }
}

const keyOf = (list: List) => (list.name === 'feed' ? `feed:${list.topicId ?? ''}` : list.name)

// The navigation entry lit for a route: a section, or a topic's id.
const activeOf = (route: Route, list: List | null): Section | 'search' | string | null => {
  if (route.name === 'search') return 'search'
  if (route.name === 'settings') return 'settings'
  if (route.name === 'listen') return 'watch'
  if (!list) return null
  if (list.name === 'feed') return list.topicId ?? 'today'
  return list.name
}

// A swipe is a quick, mostly horizontal move of a single finger.
// What eases in as the page changes: the panel's content (inside its scrollbars once they are set up), or the phone's screen.
const panelContent = (main: HTMLElement) =>
  main.querySelector('[data-overlayscrollbars-contents]') ?? main.firstElementChild?.firstElementChild ?? null
const screenContent = (main: HTMLElement) => main.firstElementChild

const SWIPE_MIN_DISTANCE = 60
const SWIPE_MAX_DURATION_MS = 700

// Content that scrolls sideways itself (a slider, a wide table) keeps its own swipes.
const scrollsSideways = (target: EventTarget, boundary: Element) => {
  for (
    let element = target instanceof Element ? target : null;
    element && element !== boundary;
    element = element.parentElement
  ) {
    const { overflowX } = window.getComputedStyle(element)
    if ((overflowX === 'auto' || overflowX === 'scroll') && element.scrollWidth > element.clientWidth) return true
  }

  return false
}

interface HomePageProps {
  onLoggedOut: () => void
}

const HomePage = ({ onLoggedOut }: HomePageProps) => {
  const route = useHashRoute()
  const { t } = useTranslation()
  // A tablet held across: the desktop's sidebar, then one panel with the phone's screens or the desktop reader.
  const isTablet = useIsTabletAcross()
  const isDesktop = useIsDesktop() && !isTablet
  // The panel's scrolling element on a tablet held across; elsewhere on a phone, the page scrolls.
  const [panel, setPanel] = useState<HTMLElement | null>(null)
  const [allTopics, setAllTopics] = useState<TopicInfo[] | null>(null)
  const preferences = usePreferences()
  // The topics, in the order and with those chosen in the settings.
  const topics = allTopics
    ? orderTopics(allTopics, preferences).filter(topic => hasShownSource(topic, preferences))
    : null
  const [error, setError] = useState(false)
  // The list the reader was opened from, shown beside it on a computer; and where it was scrolled to on a phone.
  const [lastList, setLastList] = useState<List>(FEED)
  const lastScroll = useRef<{ list: string; scrollY: number } | null>(null)
  const swipe = useRef<{ x: number; y: number; time: number } | null>(null)
  // A list was shown this visit: going back from the reader returns to it. The same for the videos.
  const visitedList = useRef(false)
  const visitedWatch = useRef(false)

  const handleUnauthorized = useCallback(() => onLoggedOut(), [onLoggedOut])
  const [showShortcuts, setShowShortcuts] = useState(false)
  const openShortcuts = useCallback(() => setShowShortcuts(true), [])

  useKeyboardShortcuts(openShortcuts)
  useTheme()
  // Preferences, saved and read articles come from the server, then follow the app back to the foreground.
  useEffect(() => startUserStateSync(), [])
  // Notification settings are sent again on every visit, in case the device's subscription changed.
  useNotificationSync()

  // Asked again when they change, when the network comes back (a failure offline doesn't stay), and in another
  // language: the server names the topics in the profile's, once it knows the profile's new one.
  const language = useLanguage()
  useEffect(() => {
    const load = () =>
      getTopics()
        .then(found => {
          setAllTopics(found)
          setError(false)
        })
        .catch((loadError: unknown) => {
          if (loadError instanceof UnauthorizedError) handleUnauthorized()
          else setError(true)
        })
    void sendPendingChanges().then(load)
    window.addEventListener(TOPICS_CHANGED, load)
    window.addEventListener('online', load)
    return () => {
      window.removeEventListener(TOPICS_CHANGED, load)
      window.removeEventListener('online', load)
    }
  }, [handleUnauthorized, language])

  const routeList = listOf(route)
  const list = routeList ?? (route.name === 'article' ? lastList : null)

  // On a computer, the article open stays beside whichever list is chosen next, until another one, a video, a
  // story or the settings take its place.
  const [keptArticle, setKeptArticle] = useState<string | null>(null)
  const kept =
    route.name === 'article'
      ? route.articleId
      : routeList && route.name !== 'story' && route.name !== 'dailySummary'
        ? keptArticle
        : null
  if (keptArticle !== kept) setKeptArticle(kept)
  useEffect(() => {
    const close = () => setKeptArticle(null)
    window.addEventListener(CLOSE_READER, close)
    return () => window.removeEventListener(CLOSE_READER, close)
  }, [])
  const readerId = route.name === 'article' || isDesktop ? kept : null
  const listKey = routeList && keyOf(routeList)
  if (routeList && listKey !== keyOf(lastList)) setLastList(routeList)

  useEffect(() => {
    if (listKey) visitedList.current = true
  }, [listKey])

  const watchList = route.name === 'listen' && route.itemId === null
  useEffect(() => {
    if (watchList) visitedWatch.current = true
  }, [watchList])

  // Back from the reader on a phone or a tablet: the list shows from memory, so restore its scroll position.
  // Any other page opens at its top: on a phone the window, on a tablet the panel, would otherwise stay where the
  // last page was.
  const pageKey = listKey ?? JSON.stringify(route)
  useLayoutEffect(() => {
    if (isDesktop || (isTablet && !panel)) return
    const scroller = isTablet && panel ? panel : null
    const scrollTop = () => (scroller ? scroller.scrollTop : window.scrollY)
    const scrollTo = (top: number) => (scroller ? scroller.scrollTo({ top }) : window.scrollTo({ top }))
    const target: HTMLElement | Window = scroller ?? window

    const saved = lastScroll.current
    if (!listKey) {
      scrollTo(0)
      return
    }
    scrollTo(saved?.list === listKey ? saved.scrollY : 0)

    const handleScroll = () => {
      lastScroll.current = { list: listKey, scrollY: scrollTop() }
    }

    handleScroll()
    target.addEventListener('scroll', handleScroll, { passive: true })
    return () => target.removeEventListener('scroll', handleScroll)
  }, [pageKey, listKey, isDesktop, isTablet, panel])

  // A new page eases in. On a computer or a tablet, what the panel shows (not its frame); on a phone, the
  // screen under the navigation, the same while a story or the search's results change over it.
  const main = useRef<HTMLElement>(null)
  const inPanel = isDesktop || isTablet
  const screenKey = inPanel
    ? readerId
      ? readerId
      : route.name === 'listen'
        ? `listen-${route.itemId}`
        : route.name === 'settings'
          ? `settings-${route.section}-${route.item ?? ''}`
          : route.name === 'story'
            ? `story-${route.topicId}`
            : route.name === 'dailySummary' || route.name === 'profiles'
              ? route.name
              : 'empty'
    : route.name === 'search'
      ? 'search'
      : route.name === 'story' || route.name === 'dailySummary'
        ? '{"name":"frontPage"}'
        : JSON.stringify(route)
  useFadeIn(main, screenKey, inPanel ? panelContent : screenContent)

  // On a phone, swiping left or right on the home or a topic opens the next or previous one.
  const handleTouchStart = (event: TouchEvent<HTMLElement>) => {
    const touch = event.touches[0]
    const ignored =
      event.touches.length !== 1 ||
      (route.name !== 'frontPage' && route.name !== 'topic') ||
      // A card swiped to be saved or put away.
      (event.target instanceof Element && event.target.closest('[data-swipe]') !== null) ||
      scrollsSideways(event.target, event.currentTarget)

    swipe.current = touch && !ignored ? { x: touch.clientX, y: touch.clientY, time: event.timeStamp } : null
  }

  const handleTouchEnd = (event: TouchEvent<HTMLElement>) => {
    const start = swipe.current
    const touch = event.changedTouches[0]
    swipe.current = null
    if (!start || !touch || !topics) return

    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    const isSwipe =
      Math.abs(dx) >= SWIPE_MIN_DISTANCE &&
      Math.abs(dx) > 2 * Math.abs(dy) &&
      event.timeStamp - start.time <= SWIPE_MAX_DURATION_MS
    if (!isSwipe) return

    const pages = [FRONT_PAGE_HREF, ...topics.map(topic => topicHref(topic.id))]
    const current = route.name === 'topic' ? pages.indexOf(topicHref(route.topicId)) : 0
    const next = pages[current + (dx < 0 ? 1 : -1)]
    if (next) window.location.hash = next
  }

  const handleBack = () => {
    if (visitedList.current) window.history.back()
    else window.location.hash = FRONT_PAGE_HREF
  }

  const handleWatchBack = () => {
    if (visitedWatch.current) window.history.back()
    else window.location.hash = LISTEN_HREF
  }

  const handleLogout = async () => {
    await logout()
    onLoggedOut()
  }

  const topicOf = (topicId: string) => allTopics?.find(topic => topic.id === topicId)
  const missingTopic = <NotFound />
  const topicsFailed = (
    <EmptyState tone="danger" icon={<Newspaper size={28} />} title={t('feed.topicsFailed')}>
      {t('common.tryAgainSoon')}
    </EmptyState>
  )

  // The pages that are not lists yet look the same on both layouts (they get their own design later).
  const page: ReactNode = readerId ? (
    <Reader
      key={readerId}
      articleId={readerId}
      layout={isDesktop || isTablet ? 'desktop' : 'phone'}
      withBack={isTablet}
      onBack={handleBack}
      onUnauthorized={handleUnauthorized}
    />
  ) : route.name === 'listen' && route.itemId ? (
    <WatchPanel
      key={route.itemId}
      itemId={route.itemId}
      layout={isDesktop ? 'desktop' : 'phone'}
      onBack={handleWatchBack}
      onUnauthorized={handleUnauthorized}
    />
  ) : route.name === 'search' && isDesktop ? (
    <SearchPlaceholder />
  ) : route.name === 'settings' && (isDesktop || route.section) ? (
    <SettingsPanel
      section={route.section ?? 'reading'}
      item={route.item}
      topics={allTopics}
      layout={isDesktop ? 'desktop' : 'phone'}
      onUnauthorized={handleUnauthorized}
    />
  ) : null

  const shortcuts = showShortcuts && <ShortcutsHelp onClose={() => setShowShortcuts(false)} />

  // Offline: "Réessayer" asks again for what the page shows.
  const retry = () => {
    if (error) window.dispatchEvent(new Event(TOPICS_CHANGED))
    if (route.name === 'listen') void refreshListen()
    else if (list?.name === 'feed') void refreshDayFeed(list.topicId ?? '')
  }

  if (isDesktop) {
    const activeId = readerId
    const topic = list?.name === 'feed' && list.topicId ? topicOf(list.topicId) : undefined
    const column =
      list?.name === 'saved' ? (
        <SavedScreen layout="desktop" topics={topics ?? []} activeId={activeId} />
      ) : list?.name === 'followed' ? (
        <FollowedScreen layout="desktop" activeId={activeId} onUnauthorized={handleUnauthorized} />
      ) : list?.name === 'shares' ? (
        <SharesScreen layout="desktop" activeId={activeId} onUnauthorized={handleUnauthorized} />
      ) : list?.name === 'history' ? (
        <HistoryScreen layout="desktop" topics={topics ?? []} activeId={activeId} onUnauthorized={handleUnauthorized} />
      ) : route.name === 'listen' ? (
        <WatchList layout="desktop" activeId={route.itemId} onUnauthorized={handleUnauthorized} />
      ) : route.name === 'settings' ? (
        <SettingsNav
          layout="desktop"
          active={route.section ?? 'reading'}
          onLogout={handleLogout}
          onUnauthorized={handleUnauthorized}
        />
      ) : list?.name === 'search' ? (
        <SearchScreen
          layout="desktop"
          initialQuery={route.name === 'search' ? route.query : ''}
          topics={topics ?? []}
          activeId={activeId}
          onUnauthorized={handleUnauthorized}
        />
      ) : list?.topicId ? (
        topic ? (
          <FeedColumn
            key={topic.id}
            topicId={topic.id}
            title={topic.label}
            activeId={activeId}
            onUnauthorized={handleUnauthorized}
          />
        ) : (
          // The column's place while the topics load, so the page beside it does not jump sideways.
          allTopics === null && <div className={columnStyles.column} aria-hidden="true" />
        )
      ) : (
        list && (
          <FeedColumn topicId={null} title={t('feed.title')} activeId={activeId} onUnauthorized={handleUnauthorized} />
        )
      )
    const unknownTopic = list?.name === 'feed' && list.topicId !== null && allTopics !== null && !topic

    return (
      <div className={styles.desktop}>
        <Sidebar active={activeOf(route, list)} topics={topics} />
        {column}
        <main ref={main} className={styles.main}>
          <ScrollArea className={styles.panel}>
            {route.name === 'story' ? (
              <StoryViewer topicId={route.topicId} layout="desktop" />
            ) : route.name === 'dailySummary' ? (
              <DailySummaryStory layout="desktop" onUnauthorized={handleUnauthorized} />
            ) : (
              (page ??
              (error ? (
                topicsFailed
              ) : unknownTopic ? (
                missingTopic
              ) : route.name === 'listen' ? (
                <PanePlaceholder icon={<CirclePlay size={20} />} title={t('pane.video')}>
                  {t('pane.videoText')}
                </PanePlaceholder>
              ) : (
                <PanePlaceholder icon={<Newspaper size={20} />} title={t('pane.article')}>
                  {t('pane.articleText')}
                </PanePlaceholder>
              )))
            )}
          </ScrollArea>
        </main>
        <OfflineBanner layout="desktop" onRetry={retry} />
        {shortcuts}
      </div>
    )
  }

  const topic = route.name === 'topic' ? topicOf(route.topicId) : undefined
  // A video open on a phone: its page, without the navigation.
  const watching = route.name === 'listen' && route.itemId !== null
  const screen =
    route.name === 'frontPage' || route.name === 'story' || route.name === 'dailySummary' ? (
      <MobileHome topics={error ? [] : topics} onUnauthorized={handleUnauthorized} />
    ) : route.name === 'topic' ? (
      topic ? (
        <MobileTopic key={topic.id} topic={topic} topics={topics ?? []} onUnauthorized={handleUnauthorized} />
      ) : error ? (
        topicsFailed
      ) : (
        allTopics && missingTopic
      )
    ) : route.name === 'saved' ? (
      <SavedScreen layout="phone" topics={topics ?? []} />
    ) : route.name === 'followed' ? (
      <FollowedScreen layout="phone" onUnauthorized={handleUnauthorized} />
    ) : route.name === 'shares' ? (
      <SharesScreen layout="phone" onUnauthorized={handleUnauthorized} />
    ) : route.name === 'history' ? (
      <HistoryScreen layout="phone" topics={topics ?? []} onUnauthorized={handleUnauthorized} />
    ) : route.name === 'listen' && !route.itemId ? (
      <WatchList layout="phone" onUnauthorized={handleUnauthorized} />
    ) : route.name === 'settings' && !route.section ? (
      <SettingsNav layout="phone" active={null} onLogout={handleLogout} onUnauthorized={handleUnauthorized} />
    ) : route.name === 'search' ? (
      <SearchScreen
        layout="phone"
        initialQuery={route.query}
        topics={topics ?? []}
        onClose={closeSearch}
        onUnauthorized={handleUnauthorized}
      />
    ) : (
      page
    )

  if (isTablet)
    return (
      <div className={styles.desktop}>
        <Sidebar active={activeOf(route, list)} topics={topics} />
        <main ref={main} className={styles.main}>
          <ScrollArea className={`${styles.panel} ${styles.tabletPanel}`} onViewport={setPanel}>
            <div onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
              {route.name === 'article' ? <div className={styles.readerFrame}>{screen}</div> : screen}
            </div>
          </ScrollArea>
        </main>
        {route.name === 'story' && <StoryViewer topicId={route.topicId} layout="phone" />}
        {route.name === 'dailySummary' && <DailySummaryStory layout="phone" onUnauthorized={handleUnauthorized} />}
        <OfflineBanner layout="desktop" onRetry={retry} />
        {shortcuts}
      </div>
    )

  return (
    <div className={styles.phone}>
      {route.name !== 'article' && !watching && <OfflineBanner layout="phone" onRetry={retry} />}
      <main ref={main} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
        {screen}
      </main>
      {route.name === 'story' && <StoryViewer topicId={route.topicId} layout="phone" />}
      {route.name === 'dailySummary' && <DailySummaryStory layout="phone" onUnauthorized={handleUnauthorized} />}
      {route.name !== 'article' &&
        route.name !== 'story' &&
        route.name !== 'dailySummary' &&
        route.name !== 'search' &&
        !watching && (
          <MobileNav
            active={
              list?.name === 'feed'
                ? 'today'
                : // On a phone the history opens from the settings.
                  list?.name === 'history'
                  ? 'settings'
                  : (activeOf(route, list) as Section | 'search' | null)
            }
          />
        )}
      {shortcuts}
    </div>
  )
}

export default HomePage
