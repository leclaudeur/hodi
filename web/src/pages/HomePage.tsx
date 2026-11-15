import { useTranslation } from 'react-i18next'
import { useCallback, useEffect, useRef, useState } from 'react'
import { TOPICS_CHANGED, logout } from '../api.ts'
import MobileNav from '../app/MobileNav.tsx'
import ShortcutsHelp from '../app/ShortcutsHelp.tsx'
import Sidebar from '../app/Sidebar.tsx'
import { refreshDayFeed } from '../lib/day-feed.ts'
import { useKeyboardShortcuts } from '../lib/keyboard-shortcuts.ts'
import { refreshListen } from '../lib/listen.ts'
import { useNotificationSync } from '../lib/notifications.ts'
import { hasShownSource, orderTopics, usePreferences } from '../lib/preferences.ts'
import { useTheme } from '../lib/theme.ts'
import { useFadeIn } from '../lib/use-fade-in.ts'
import { useHashRoute } from '../lib/use-hash-route.ts'
import { useIsDesktop, useIsTabletAcross } from '../lib/use-media.ts'
import { startUserStateSync } from '../lib/user-state.ts'
import OfflineBanner from '../ui/OfflineBanner.tsx'
import ScrollArea from '../ui/ScrollArea.tsx'
import DailySummaryStory from '../views/DailySummaryStory.tsx'
import StoryViewer from '../views/StoryViewer.tsx'
import styles from './HomePage.module.css'
import { activeOf, panelContent, phoneActiveOf, screenContent, screenKeyOf } from './home-routes.ts'
import { type Home, columnOf, detailOf, paneOf, screenOf } from './home-views.tsx'
import { useBackWays, useList, usePageSwipe, useReaderId, useScrollMemory, useTopics } from './use-home.ts'

interface HomePageProps {
  onLoggedOut: () => void
}

// Everything the page knows: the route, its list, the topics and the article open.
const useHome = (onLoggedOut: () => void, isDesktop: boolean, isTablet: boolean) => {
  const route = useHashRoute()
  const { t } = useTranslation()
  const preferences = usePreferences()
  const handleUnauthorized = useCallback(() => onLoggedOut(), [onLoggedOut])
  // Preferences, saved and read articles come from the server, then follow the app back to the foreground.
  useEffect(() => startUserStateSync(), [])
  // Notification settings are sent again on every visit, in case the device's subscription changed.
  useNotificationSync()
  const { allTopics, error } = useTopics(handleUnauthorized)
  // The topics, in the order and with those chosen in the settings.
  const topics = allTopics
    ? orderTopics(allTopics, preferences).filter(topic => hasShownSource(topic, preferences))
    : null
  const { routeList, list, listKey } = useList(route)
  const readerId = useReaderId(route, routeList, isDesktop)
  const { onBack, onWatchBack } = useBackWays(listKey, route)
  const onLogout = async () => {
    await logout()
    onLoggedOut()
  }
  const home: Home = {
    ...{ route, list, topics, allTopics, error, readerId, isDesktop, isTablet, onBack, onWatchBack, onLogout, t },
    onUnauthorized: handleUnauthorized
  }
  return { home, listKey }
}

const HomePage = ({ onLoggedOut }: HomePageProps) => {
  // A tablet held across: the desktop's sidebar, then one panel with the phone's screens or the desktop reader.
  const isTablet = useIsTabletAcross()
  const isDesktop = useIsDesktop() && !isTablet
  // The panel's scrolling element on a tablet held across; elsewhere on a phone, the page scrolls.
  const [panel, setPanel] = useState<HTMLElement | null>(null)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const openShortcuts = useCallback(() => setShowShortcuts(true), [])
  useKeyboardShortcuts(openShortcuts)
  useTheme()
  const { home, listKey } = useHome(onLoggedOut, isDesktop, isTablet)
  const { route, list, topics } = home
  useScrollMemory(route, listKey, isDesktop, isTablet, panel)

  // A new page eases in. On a computer or a tablet, what the panel shows (not its frame); on a phone, the
  // screen under the navigation, the same while a story or the search's results change over it.
  const main = useRef<HTMLElement>(null)
  const inPanel = isDesktop || isTablet
  useFadeIn(main, screenKeyOf(route, home.readerId, inPanel), inPanel ? panelContent : screenContent)
  const swipe = usePageSwipe(route, topics)

  const page = detailOf(home)
  const shortcuts = showShortcuts && <ShortcutsHelp onClose={() => setShowShortcuts(false)} />

  // Offline: "Réessayer" asks again for what the page shows.
  const retry = () => {
    if (home.error) window.dispatchEvent(new Event(TOPICS_CHANGED))
    if (route.name === 'listen') void refreshListen()
    else if (list?.name === 'feed') void refreshDayFeed(list.topicId ?? '')
  }

  if (isDesktop) {
    return (
      <div className={styles.desktop}>
        <Sidebar active={activeOf(route, list)} topics={topics} />
        {columnOf(home)}
        <main ref={main} className={styles.main}>
          <ScrollArea className={styles.panel}>{paneOf(home, page)}</ScrollArea>
        </main>
        <OfflineBanner layout="desktop" onRetry={retry} />
        {shortcuts}
      </div>
    )
  }

  const screen = screenOf(home, page)
  // A video open on a phone: its page, without the navigation.
  const watching = route.name === 'listen' && route.itemId !== null
  if (isTablet)
    return (
      <div className={styles.desktop}>
        <Sidebar active={activeOf(route, list)} topics={topics} />
        <main ref={main} className={styles.main}>
          <ScrollArea className={`${styles.panel} ${styles.tabletPanel}`} onViewport={setPanel}>
            <div {...swipe}>
              {route.name === 'article' ? <div className={styles.readerFrame}>{screen}</div> : screen}
            </div>
          </ScrollArea>
        </main>
        {route.name === 'story' && <StoryViewer topicId={route.topicId} layout="phone" />}
        {route.name === 'dailySummary' && <DailySummaryStory layout="phone" onUnauthorized={home.onUnauthorized} />}
        <OfflineBanner layout="desktop" onRetry={retry} />
        {shortcuts}
      </div>
    )

  const navHidden = ['article', 'story', 'dailySummary', 'search'].includes(route.name) || watching
  return (
    <div className={styles.phone}>
      {route.name !== 'article' && !watching && <OfflineBanner layout="phone" onRetry={retry} />}
      <main ref={main} {...swipe}>
        {screen}
      </main>
      {route.name === 'story' && <StoryViewer topicId={route.topicId} layout="phone" />}
      {route.name === 'dailySummary' && <DailySummaryStory layout="phone" onUnauthorized={home.onUnauthorized} />}
      {!navHidden && <MobileNav active={phoneActiveOf(route, list)} />}
      {shortcuts}
    </div>
  )
}

export default HomePage
