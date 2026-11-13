import { type TouchEvent, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { TOPICS_CHANGED, type TopicInfo, UnauthorizedError, getTopics } from '../api.ts'
import { useLanguage } from '../lib/i18n.ts'
import { CLOSE_READER, FRONT_PAGE_HREF, LISTEN_HREF, type Route, topicHref } from '../lib/use-hash-route.ts'
import { sendPendingChanges } from '../lib/user-state.ts'
import { FEED, type List, keptOf, keyOf, listOf } from './home-routes.ts'

const SWIPE_MIN_DISTANCE = 60
const SWIPE_MAX_DURATION_MS = 700

// The household's topics. Asked again when they change, when the network comes back (a failure offline doesn't
// stay), and in another language: the server names the topics in the profile's, once it knows the profile's new one.
export const useTopics = (handleUnauthorized: () => void) => {
  const [allTopics, setAllTopics] = useState<TopicInfo[] | null>(null)
  const [error, setError] = useState(false)
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
  return { allTopics, error }
}

// The list the route shows, and the one the reader was opened from, shown beside it on a computer.
export const useList = (route: Route) => {
  const [lastList, setLastList] = useState<List>(FEED)
  const routeList = listOf(route)
  const list = routeList ?? (route.name === 'article' ? lastList : null)
  const listKey = routeList && keyOf(routeList)
  if (routeList && listKey !== keyOf(lastList)) setLastList(routeList)
  return { routeList, list, listKey }
}

// The article open in the reader: on a computer, it stays beside the lists chosen next (keptOf).
export const useReaderId = (route: Route, routeList: List | null, isDesktop: boolean) => {
  const [keptArticle, setKeptArticle] = useState<string | null>(null)
  const kept = keptOf(route, routeList, keptArticle)
  if (keptArticle !== kept) setKeptArticle(kept)
  useEffect(() => {
    const close = () => setKeptArticle(null)
    window.addEventListener(CLOSE_READER, close)
    return () => window.removeEventListener(CLOSE_READER, close)
  }, [])
  return route.name === 'article' || isDesktop ? kept : null
}

// A list was shown this visit: going back from the reader returns to it. The same for the videos.
export const useBackWays = (listKey: string | null, route: Route) => {
  const visitedList = useRef(false)
  const visitedWatch = useRef(false)
  useEffect(() => {
    if (listKey) visitedList.current = true
  }, [listKey])
  const watchList = route.name === 'listen' && route.itemId === null
  useEffect(() => {
    if (watchList) visitedWatch.current = true
  }, [watchList])
  const onBack = () => {
    if (visitedList.current) window.history.back()
    else window.location.hash = FRONT_PAGE_HREF
  }
  const onWatchBack = () => {
    if (visitedWatch.current) window.history.back()
    else window.location.hash = LISTEN_HREF
  }
  return { onBack, onWatchBack }
}

// Back from the reader on a phone or a tablet: the list shows from memory, so restore its scroll position.
// Any other page opens at its top: on a phone the window, on a tablet the panel, would otherwise stay where the
// last page was.
export const useScrollMemory = (
  route: Route,
  listKey: string | null,
  isDesktop: boolean,
  isTablet: boolean,
  panel: HTMLElement | null
) => {
  const lastScroll = useRef<{ list: string; scrollY: number } | null>(null)
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
}

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

// Not a page swipe: several fingers, a page with no neighbours, a card swiped to be saved or put away, or content
// that scrolls sideways.
const ignoredTouch = (event: TouchEvent<HTMLElement>, route: Route) =>
  event.touches.length !== 1 ||
  (route.name !== 'frontPage' && route.name !== 'topic') ||
  (event.target instanceof Element && event.target.closest('[data-swipe]') !== null) ||
  scrollsSideways(event.target, event.currentTarget)

// A swipe is a quick, mostly horizontal move of a single finger.
const isSwipe = (dx: number, dy: number, duration: number) =>
  Math.abs(dx) >= SWIPE_MIN_DISTANCE && Math.abs(dx) > 2 * Math.abs(dy) && duration <= SWIPE_MAX_DURATION_MS

// On a phone, swiping left or right on the home or a topic opens the next or previous one.
export const usePageSwipe = (route: Route, topics: TopicInfo[] | null) => {
  const swipe = useRef<{ x: number; y: number; time: number } | null>(null)

  const onTouchStart = (event: TouchEvent<HTMLElement>) => {
    const touch = event.touches[0]
    const ignored = ignoredTouch(event, route)
    swipe.current = touch && !ignored ? { x: touch.clientX, y: touch.clientY, time: event.timeStamp } : null
  }

  const onTouchEnd = (event: TouchEvent<HTMLElement>) => {
    const start = swipe.current
    const touch = event.changedTouches[0]
    swipe.current = null
    if (!start || !touch || !topics) return
    const dx = touch.clientX - start.x
    if (!isSwipe(dx, touch.clientY - start.y, event.timeStamp - start.time)) return
    const pages = [FRONT_PAGE_HREF, ...topics.map(topic => topicHref(topic.id))]
    const current = route.name === 'topic' ? pages.indexOf(topicHref(route.topicId)) : 0
    const next = pages[current + (dx < 0 ? 1 : -1)]
    if (next) window.location.hash = next
  }

  return { onTouchStart, onTouchEnd }
}
