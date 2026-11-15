import { useEffect, useSyncExternalStore } from 'react'
import { UnauthorizedError } from '../api.ts'
import { t } from './i18n.ts'
import { getPreferences, usePreferences } from './preferences.ts'
import { showSaved } from './toast.ts'

// Notifications for followed subjects. These settings belong to this device only: they are not synced.
const STORAGE_KEY = 'hodi:notifications'

export interface NotificationSettings {
  enabled: boolean
  // The number of new articles on the app icon.
  badge: boolean
  // "HH:MM": nothing is sent between these times. Equal times mean no quiet hours.
  quietStart: string
  quietEnd: string
  // Followed subjects without an alert: still starred and listed in "Suivis", never notified.
  silentWords: string[]
  // An article another profile of the household sends here.
  shares: boolean
  // Someone reacting to an article this profile sent them.
  reactions: boolean
  // What a plugin of the household sends (a reminder, an answer to a request).
  plugins: boolean
}

const DEFAULTS: NotificationSettings = {
  enabled: false,
  badge: true,
  quietStart: '22:00',
  quietEnd: '07:00',
  silentWords: [],
  shares: true,
  reactions: true,
  plugins: true
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

const load = (): NotificationSettings => {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<NotificationSettings>
    return {
      enabled: stored.enabled === true,
      badge: stored.badge !== false,
      quietStart: TIME_PATTERN.test(stored.quietStart ?? '') ? stored.quietStart! : DEFAULTS.quietStart,
      quietEnd: TIME_PATTERN.test(stored.quietEnd ?? '') ? stored.quietEnd! : DEFAULTS.quietEnd,
      silentWords: Array.isArray(stored.silentWords)
        ? stored.silentWords.filter((word): word is string => typeof word === 'string')
        : [],
      shares: stored.shares !== false,
      reactions: stored.reactions !== false,
      plugins: stored.plugins !== false
    }
  } catch {
    return DEFAULTS
  }
}

let settings = load()
const listeners = new Set<() => void>()

const save = (next: NotificationSettings) => {
  settings = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Private mode: the settings last for this visit.
  }
  listeners.forEach(listener => listener())
}

export const useNotificationSettings = () =>
  useSyncExternalStore(
    listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => settings
  )

// unsupported: this browser cannot receive them (on an iPhone, only Hodi added to the home screen can).
export const notificationSupport = (): 'supported' | 'unsupported' =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window ? 'supported' : 'unsupported'

const send = async (method: 'PUT' | 'DELETE' | 'POST', route: string, body: unknown) => {
  const response = await fetch(`/api/push/${route}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (response.status === 401) throw new UnauthorizedError('Session expired')
  if (!response.ok) throw new Error(`${method} ${route} failed with status ${response.status}`)
}

// The server's public key, or null when notifications are not set up there.
export const getPushKey = async () => {
  const response = await fetch('/api/push/key')
  if (response.status === 401) throw new UnauthorizedError('Session expired')
  if (!response.ok) return null
  return ((await response.json()) as { publicKey: string }).publicKey
}

const fromBase64Url = (text: string) => {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

const currentSubscription = async () => {
  const registration = await navigator.serviceWorker.ready
  return registration.pushManager.getSubscription()
}

// Tells the server what this device follows. Sent each time the app opens, as the server keeps it in memory only.
const register = async (subscription: PushSubscription) => {
  const { followedWords, mutedWords, hiddenSources } = getPreferences()
  await send('PUT', 'subscription', {
    target: subscription.toJSON(),
    words: followedWords.filter(word => !settings.silentWords.includes(word)),
    mutedWords,
    hiddenSources,
    quietStart: settings.quietStart,
    quietEnd: settings.quietEnd,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    badge: settings.badge,
    shares: settings.shares,
    reactions: settings.reactions,
    plugins: settings.plugins
  })
}

// The browser can drop a subscription: a new one is made with the permission already given.
const resubscribe = async () => {
  const registration = await navigator.serviceWorker.ready
  const existing = await registration.pushManager.getSubscription()
  if (existing) return existing

  const key = await getPushKey()
  if (!key) throw new Error('Notifications are off on the server')
  return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromBase64Url(key) })
}

export type EnableResult = 'enabled' | 'denied' | 'unavailable' | 'brave' | 'failed'

// Brave turns its push service off until "Use Google services for push messaging" is on.
const isBrave = () => 'brave' in navigator

// Asks for permission (it must follow a tap on iOS), subscribes and registers.
export const enableNotifications = async (): Promise<EnableResult> => {
  try {
    const key = await getPushKey()
    if (!key) return 'unavailable'
    if ((await Notification.requestPermission()) !== 'granted') return 'denied'

    const subscription = await resubscribe().catch((error: unknown) => {
      if (error instanceof DOMException && isBrave()) return null
      throw error
    })
    if (!subscription) return 'brave'
    save({ ...settings, enabled: true })
    await register(subscription)
    return 'enabled'
  } catch (error) {
    if (error instanceof UnauthorizedError) throw error
    return 'failed'
  }
}

export const disableNotifications = async () => {
  save({ ...settings, enabled: false })
  const subscription = await currentSubscription().catch(() => null)
  if (!subscription) return
  await send('DELETE', 'subscription', { endpoint: subscription.endpoint }).catch(() => {})
  await subscription.unsubscribe().catch(() => {})
  await navigator.clearAppBadge?.().catch(() => {})
}

export const updateNotificationSettings = (changes: Partial<Omit<NotificationSettings, 'enabled'>>) => {
  save({ ...settings, ...changes })
  showSaved()
}

// A notification shown by this device itself, to check that they come through.
export const testNotification = async () => {
  const registration = await navigator.serviceWorker.ready
  await registration.showNotification('Hodi', {
    body: t('settings.notifications.testBody'),
    icon: '/icon-192.png',
    tag: 'hodi-test'
  })
}

// "Suivis" was opened: the icon's count goes back to zero.
export const markFollowedSeen = async () => {
  await navigator.clearAppBadge?.().catch(() => {})
  if (!settings.enabled || notificationSupport() !== 'supported') return
  const subscription = await currentSubscription().catch(() => null)
  if (subscription) await send('POST', 'seen', { endpoint: subscription.endpoint }).catch(() => {})
}

// Registers again when the app opens and whenever what it follows changes.
export const useNotificationSync = () => {
  const preferences = usePreferences()
  const current = useNotificationSettings()

  useEffect(() => {
    if (!current.enabled || notificationSupport() !== 'supported' || Notification.permission !== 'granted') return

    // A burst of changes in the settings sends one update.
    const timer = window.setTimeout(() => {
      resubscribe()
        .then(register)
        .catch(() => {})
    }, 500)

    return () => window.clearTimeout(timer)
  }, [preferences, current])
}
