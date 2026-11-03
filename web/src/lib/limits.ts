import { useEffect, useState, useSyncExternalStore } from 'react'
import { type MyLimits, type YouthLimits, getMyLimits, sendHeartbeat } from '../api.ts'
import { t } from './i18n.ts'
import { showInfo } from './toast.ts'

// A young profile's time a day and hours, set by its parents. The server counts the time and knows the household's
// clock: the app only says it is on screen, every 30 seconds while it is visible, and shows "À demain" when the
// server says it is closed. Changing the device's clock or reloading changes nothing.

const HEARTBEAT_MS = 30_000
// "Plus que 5 minutes": once a day, when the time left goes under it.
const WARNING_SECONDS = 5 * 60

interface LimitsState {
  limits: YouthLimits
  // When the server sent them (ms, this device's clock): the countdown goes on from there.
  at: number
}

let state: LimitsState | null = null
// The first answer came (or failed, offline): until then the app shows nothing, so a young profile out of its time
// never sees the feed flash before "À demain".
let ready = false
let warnedDay: string | null = null
const listeners = new Set<() => void>()

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const today = () => new Date().toDateString()

// The seconds left now, counted down from what the server said; null: no daily limit.
export const remainingNow = (value: LimitsState, now = Date.now()) =>
  value.limits.remainingSeconds === null
    ? null
    : Math.max(0, value.limits.remainingSeconds - Math.floor((now - value.at) / 1000))

const commit = (next: MyLimits) => {
  state = next.limited ? { limits: next, at: Date.now() } : null
  const left = state ? remainingNow(state) : null
  // A day of 5 minutes or less starts under the warning: it would only repeat the limit.
  const daily = state ? (state.limits.rules.dailyMinutes ?? 0) * 60 : 0
  if (left !== null && left > 0 && left <= WARNING_SECONDS && daily > WARNING_SECONDS && warnedDay !== today()) {
    warnedDay = today()
    showInfo(t('limits.fiveMinutes'), 'limits-warning')
  }
  listeners.forEach(listener => listener())
}

const settle = () => {
  if (ready) return
  ready = true
  listeners.forEach(listener => listener())
}

const ask = (call: () => Promise<MyLimits>) =>
  call()
    .then(commit)
    .catch(() => {})
    .finally(settle)

let started = false

// Once the profile is open: its limits, then a heartbeat while the app is on screen, for the page's life (another
// profile reloads the app). Nothing for an adult.
export const startLimits = () => {
  if (started) return
  started = true
  let closing: number | undefined

  const beat = () => {
    if (document.visibilityState !== 'visible') return
    void ask(sendHeartbeat).then(plan)
  }

  // At the moment it closes (time spent, end of its hours) or opens again, the server is asked at once.
  const plan = () => {
    window.clearTimeout(closing)
    if (!state) return
    const { limits } = state
    const left = remainingNow(state)
    const next =
      limits.access === 'open'
        ? Math.min(limits.closesAt ?? Infinity, Date.now() + (left ?? Infinity) * 1000)
        : (limits.opensAt ?? Infinity)
    if (next !== Infinity) closing = window.setTimeout(beat, Math.max(1000, next - Date.now() + 500))
  }

  // No timer at all while the app is hidden: a phone in a pocket is not woken every 30 seconds for nothing.
  let heartbeat: number | undefined
  const watch = () => {
    window.clearInterval(heartbeat)
    if (document.visibilityState !== 'visible') return
    beat()
    heartbeat = window.setInterval(beat, HEARTBEAT_MS)
  }

  void ask(getMyLimits).then(() => {
    if (!state) return
    watch()
    document.addEventListener('visibilitychange', watch)
  })
}

// null for an adult, or until the limits come.
export const useLimits = () => useSyncExternalStore(subscribe, () => state)

// False until the profile's limits are known.
export const useLimitsReady = () => useSyncExternalStore(subscribe, () => ready)

// The seconds left, ticking every second while shown; null: no daily limit, or an adult.
export const useCountdown = () => {
  const value = useLimits()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!value || value.limits.remainingSeconds === null) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [value])
  return value ? remainingNow(value, now) : null
}
