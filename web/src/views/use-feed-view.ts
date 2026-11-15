import { useEffect } from 'react'
import type { TopicItem } from '../api.ts'
import { useConnection } from '../lib/connection.ts'
import { loadPreviousDay, refreshDayFeed, useDayFeed } from '../lib/day-feed.ts'
import { loadDayLabel } from '../lib/format.ts'
import { isHidden, usePreferences } from '../lib/preferences.ts'
import { useReadState } from '../lib/read-state.ts'
import type { DayGroup } from './ArticleList.tsx'
import { t } from '../lib/i18n.ts'

// A day just loaded under the list: its separator comes up to the top, so its articles are there without
// scrolling past the button. Its section, as the separator sticks to the top of whichever day is under it.
// Once more when the glide is over: cards drawn only once on the screen (content-visibility) may have changed
// their height on the way, moving the day a little.
export const revealDay = (day: string) => {
  const reveal = () => {
    const section = [...document.querySelectorAll<HTMLElement>(`[data-day="${day}"]`)].find(
      element => element.getClientRects().length > 0
    )
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    section?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' })
  }
  requestAnimationFrame(reveal)
  window.setTimeout(reveal, GLIDE_MS)
}
const GLIDE_MS = 700

// What Le fil and a topic's list show, on a desktop or a phone: the days loaded so far, without the
// articles the settings hide (read ones, muted sources and words).
export const useFeedView = (scope: string, onUnauthorized: () => void) => {
  const state = useDayFeed(scope)
  const preferences = usePreferences()
  const { online } = useConnection()
  // Read, then closed, or put away: the list is filtered again.
  useReadState()

  useEffect(() => {
    if (state.unauthorized) onUnauthorized()
  }, [state.unauthorized, onUnauthorized])

  const groups: DayGroup[] = state.days
    .map(day => ({ day: day.day, items: day.items.filter(item => !isHidden(item, preferences)) }))
    .filter(group => group.items.length > 0)
  const items: TopicItem[] = groups.flatMap(group => group.items)
  const listed = state.days.reduce((count, day) => count + day.items.length, 0)
  const today = state.days[0]

  return {
    groups,
    items,
    // Nothing yet: the first load, or today's articles still being checked while today is asked again. When it
    // gives up (or the list was left meanwhile), the empty state shows instead of a loader that never ends.
    waiting: state.days.length === 0 ? !state.error : items.length === 0 && state.polling && (today?.checking ?? 0) > 0,
    failed: state.error && state.days.length === 0,
    // Every article listed is hidden by the settings.
    allHidden: listed > 0 && items.length === 0,
    loading: state.loading,
    loadedAt: state.loadedAt,
    todayCount: today?.items.length ?? 0,
    // "64 ARTICLES · 3 JOURS".
    meta:
      items.length > 0
        ? `${t('count.article', { count: items.length })} · ${t('count.day', { count: state.days.length })}`
        : undefined,
    // Offline, only today's articles are kept on this device: an earlier day has nothing to load.
    previousDay: online ? (state.days.at(-1)?.previousDay ?? null) : null,
    // "Charger jeudi 22.10".
    loadDayLabel: (compact = false) => {
      const previous = state.days.at(-1)?.previousDay
      return previous ? loadDayLabel(previous, compact) : ''
    },
    loadPrevious: () => {
      const day = state.days.at(-1)?.previousDay
      void loadPreviousDay(scope).then(() => day && revealDay(day))
    },
    refresh: () => refreshDayFeed(scope)
  }
}
