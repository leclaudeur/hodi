import { useSyncExternalStore } from 'react'
import type { FeedItem } from '../api.ts'
import { type Language, getLanguage, t } from './i18n.ts'

// How the household writes the time of day (Réglages › Foyer): 24 ("21:00") or 12 ("9:00 PM"). Kept on the device
// too, so the first screen shows the right one before the server answers.
export type HourCycle = 12 | 24
const HOUR_CYCLE_KEY = 'hodi:hour-cycle'
let hourCycle: HourCycle = (() => {
  try {
    return localStorage.getItem(HOUR_CYCLE_KEY) === '12' ? 12 : 24
  } catch {
    return 24
  }
})()
const hourCycleListeners = new Set<() => void>()

export const setHourCycle = (next: HourCycle) => {
  if (next === hourCycle) return
  hourCycle = next
  try {
    localStorage.setItem(HOUR_CYCLE_KEY, String(next))
  } catch {
    // Private browsing: the household's setting again at the next start.
  }
  formatters.clear()
  hourCycleListeners.forEach(listener => listener())
}

export const getHourCycle = () => hourCycle

export const useHourCycle = () =>
  useSyncExternalStore(
    listener => {
      hourCycleListeners.add(listener)
      return () => hourCycleListeners.delete(listener)
    },
    () => hourCycle
  )

// The formatters of the interface language and the household's hour cycle, made once per language.
export const LOCALES: Record<Language, string> = { fr: 'fr-BE', en: 'en-GB' }
const formatters = new Map<Language, ReturnType<typeof makeFormatters>>()
const hours = () =>
  hourCycle === 12 ? ({ hour: 'numeric', hourCycle: 'h12' } as const) : ({ hour: '2-digit', hourCycle: 'h23' } as const)
const makeFormatters = (language: Language) => ({
  relative: new Intl.RelativeTimeFormat(language, { numeric: 'auto', style: 'short' }),
  day: new Intl.DateTimeFormat(LOCALES[language], {
    day: 'numeric',
    month: 'long',
    ...hours(),
    minute: '2-digit'
  }),
  weekday: new Intl.DateTimeFormat(LOCALES[language], { weekday: 'short', timeZone: 'UTC' }),
  weekdayLong: new Intl.DateTimeFormat(LOCALES[language], { weekday: 'long', timeZone: 'UTC' }),
  clock: new Intl.DateTimeFormat(LOCALES[language], { ...hours(), minute: '2-digit' }),
  // An hour without its day, written in UTC so the time zone never moves it.
  hourOfDay: new Intl.DateTimeFormat(LOCALES[language], { ...hours(), minute: '2-digit', timeZone: 'UTC' })
})
const format = () => {
  const language = getLanguage()
  let made = formatters.get(language)
  if (!made) {
    made = makeFormatters(language)
    formatters.set(language, made)
  }
  return made
}

// "il y a 25 min", "il y a 3 h", "hier"…
export const timeAgo = (iso: string | null, now = Date.now()) => {
  if (!iso) return null

  const minutes = Math.round((new Date(iso).getTime() - now) / 60_000)

  const { relative } = format()
  if (Math.abs(minutes) < 60) return relative.format(Math.min(minutes, -1), 'minute')
  if (Math.abs(minutes) < 24 * 60) return relative.format(Math.round(minutes / 60), 'hour')

  return relative.format(Math.round(minutes / (24 * 60)), 'day')
}

// "08:12" or "8:12 AM", the time of day.
export const clockTime = (date: Date | number) => format().clock.format(date)

// "21:00" (an hour set in Réglages) as the household writes it: "21:00" or "9:00 PM", never broken between the
// hour and its period in a running sentence.
export const hourText = (hhmm: string) => {
  const [hour = 0, minute = 0] = hhmm.split(':').map(Number)
  return format()
    .hourOfDay.format(Date.UTC(2000, 0, 1, hour, minute))
    .replace(/\s/g, '\u00a0')
}

export const fullDate = (iso: string | null) => (iso ? format().day.format(new Date(iso)) : null)

export const hostOf = (link: string) => new URL(link).hostname.replace(/^www\./, '')

// Mobile cards: "40 MIN", "3 H", "2 J".
export const shortAgo = (iso: string | null, now = Date.now()) => {
  if (!iso) return null
  const minutes = Math.max(1, Math.round((now - new Date(iso).getTime()) / 60_000))
  if (minutes < 60) return t('time.minutes', { count: minutes })
  if (minutes < 24 * 60) return t('time.hours', { count: Math.round(minutes / 60) })
  return t('time.days', { count: Math.round(minutes / (24 * 60)) })
}

const DAY_MS = 24 * 60 * 60 * 1000

// A calendar day of "Le fil" (YYYY-MM-DD, local), as the charter writes it: "ven. 24.10", "vendredi 24.10".
const dayParts = (day: string) => {
  const date = new Date(`${day}T00:00:00Z`)
  const { weekday, weekdayLong } = format()
  const numbers = `${day.slice(8, 10)}.${day.slice(5, 7)}`
  return {
    short: t('time.day', { weekday: weekday.format(date).replace('.', ''), numbers }),
    long: `${weekdayLong.format(date)} ${numbers}`
  }
}

export const localDay = (at = Date.now()) => {
  const date = new Date(at)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// "AUJOURD'HUI", "HIER · JEU. 23.10", "MER. 22.10".
export const dayLabel = (day: string, now = Date.now()) => {
  const { short } = dayParts(day)
  if (day === localDay(now)) return t('time.today')
  if (day === localDay(now - DAY_MS)) return t('time.yesterday', { day: short })
  return short
}

// "Charger mercredi 22.10" (desktop), "Charger mer. 22.10" (mobile).
export const loadDayLabel = (day: string, compact = false) => {
  const { short, long } = dayParts(day)
  return t('feed.loadDay', { day: compact ? short : long })
}

// "ven. 24.10", for the mobile header.
export const todayLabel = (now = Date.now()) => dayParts(localDay(now)).short.toUpperCase()

// "24.10.2026", in the reader.
export const numericDate = (iso: string | null) => {
  if (!iso) return null
  const date = new Date(iso)
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`
}

// The local day an article came out on.
export const dayOfItem = (iso: string | null, now = Date.now()) => localDay(iso ? new Date(iso).getTime() : now)

// A video's or an episode's length: "01:38", "12:34", "01:02:03".
export const formatDuration = (seconds: number) => {
  const total = Math.round(seconds)
  const parts = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60]
  return (parts[0] ? parts : parts.slice(1)).map(part => String(part).padStart(2, '0')).join(':')
}

// "3 articles · 2 vidéos": each kind the history holds.
export const countByKind = (items: Pick<FeedItem, 'kind'>[]) => {
  const videos = items.filter(item => item.kind === 'video').length
  const episodes = items.filter(item => item.kind === 'podcast').length
  const articles = items.length - videos - episodes
  return [
    articles > 0 && t('count.article', { count: articles }),
    videos > 0 && t('count.video', { count: videos }),
    episodes > 0 && t('count.episode', { count: episodes })
  ]
    .filter(Boolean)
    .join(' · ')
}
