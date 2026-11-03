import type { FeedItem } from './feed-parser.ts'
import { truncate } from './text.ts'
import { foldText, wordPattern } from './word-match.ts'

// A browser's push subscription, as PushSubscription.toJSON() gives it.
export interface PushTarget {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

// What a device asks to be told about. The app sends it again each time it opens; the store keeps it across restarts.
export interface AlertSettings {
  target: PushTarget
  words: string[]
  mutedWords: string[]
  hiddenSources: string[]
  // "HH:MM" in timeZone; equal times mean no quiet hours.
  quietStart: string
  quietEnd: string
  timeZone: string
  // Show the number of new articles on the app icon.
  badge: boolean
  // Told when another profile of the household sends an article here. Missing on devices registered before: on.
  shares?: boolean
  // Told when someone reacts to an article this profile sent them. Missing on devices registered before: on.
  reactions?: boolean
  // The profile open on the device, set by the server: the device stops when the profile is deleted.
  profileId?: number
}

export interface AlertPayload {
  title: string
  body: string
  // Hash route the notification opens.
  url: string
  // One notification per subject: a newer one replaces it.
  tag: string
  badge: number | null
}

// Rejects with statusCode 404 or 410 when the subscription is gone.
export type SendPush = (target: PushTarget, payload: AlertPayload) => Promise<void>

// Where devices are kept between restarts.
export interface SubscriptionStore {
  list: () => AlertSettings[]
  save: (settings: AlertSettings) => void
  remove: (endpoint: string) => void
}

export interface FollowedAlertsOptions {
  // The articles of every topic that open in the reader.
  listItems: () => Promise<FeedItem[]>
  send: SendPush
  subscriptions?: SubscriptionStore
  now?: () => number
  log?: (message: string) => void
  // false: the profile is told nothing now (a young profile in its parents' quiet hours, or out of its time).
  mayNotify?: (profileId: number, now: number) => boolean
}

const HOUR_MS = 60 * 60 * 1000
export const CHECK_INTERVAL_MS = 10 * 60 * 1000
// At most one notification per subject in this time; articles in between are grouped into the next one.
export const SUBJECT_COOLDOWN_MS = 3 * HOUR_MS
export const MAX_ALERTS_PER_DAY = 12
// Older articles are never announced, even for a subject just followed.
const MAX_ARTICLE_AGE_MS = 24 * HOUR_MS
const MAX_DEVICES = 10
const MAX_KNOWN_IDS = 2000
// About three lines of a notification.
const PREVIEW_LENGTH = 160

// Push services of the browsers that can install Hodi: nothing else is ever sent a request.
const PUSH_HOSTS = [
  /^web\.push\.apple\.com$/,
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /\.notify\.windows\.com$/
]

export const isPushEndpoint = (endpoint: string) => {
  try {
    const url = new URL(endpoint)
    return url.protocol === 'https:' && PUSH_HOSTS.some(host => host.test(url.hostname))
  } catch {
    return false
  }
}

interface Pending {
  items: FeedItem[]
}

interface Device {
  settings: AlertSettings
  // When each subject was first followed here: only articles published since are announced.
  since: Map<string, number>
  lastSent: Map<string, number>
  pending: Map<string, Pending>
  known: Set<string>
  sentTimes: number[]
  unseen: number
}

const minutesOf = (time: string) => {
  const [hours, minutes] = time.split(':').map(Number)
  return (hours ?? 0) * 60 + (minutes ?? 0)
}

export const inQuietHours = ({ quietStart, quietEnd, timeZone }: AlertSettings, now: number) => {
  const start = minutesOf(quietStart)
  const end = minutesOf(quietEnd)
  if (start === end) return false

  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(now))
    .reduce<Record<string, string>>((all, part) => ({ ...all, [part.type]: part.value }), {})
  const current = Number(parts.hour) * 60 + Number(parts.minute)

  // 22:00 to 07:00 spans midnight.
  return start < end ? current >= start && current < end : current >= start || current < end
}

// "Notifications" for followed subjects: new articles about them, grouped, outside quiet hours, within a daily cap.
export class FollowedAlerts {
  readonly #listItems: () => Promise<FeedItem[]>
  readonly #send: SendPush
  readonly #now: () => number
  readonly #log: (message: string) => void
  readonly #mayNotify: (profileId: number, now: number) => boolean
  readonly #subscriptions: SubscriptionStore | undefined
  readonly #devices = new Map<string, Device>()
  #timer: NodeJS.Timeout | null = null
  #running: Promise<void> | null = null

  constructor({
    listItems,
    send,
    subscriptions,
    now = Date.now,
    log = console.warn,
    mayNotify = () => true
  }: FollowedAlertsOptions) {
    this.#mayNotify = mayNotify
    this.#listItems = listItems
    this.#send = send
    this.#subscriptions = subscriptions
    this.#now = now
    this.#log = log

    // Devices known before the restart: only articles published from now on are announced to them.
    subscriptions?.list().forEach(settings => this.#add(settings))
  }

  #forget(endpoint: string) {
    this.#devices.delete(endpoint)
    this.#subscriptions?.remove(endpoint)
  }

  get size() {
    return this.#devices.size
  }

  // Adds the device or updates what it follows.
  register(settings: AlertSettings) {
    this.#add(settings)
    this.#subscriptions?.save(settings)
  }

  #add(settings: AlertSettings) {
    const now = this.#now()
    const { endpoint } = settings.target
    const existing = this.#devices.get(endpoint)

    if (!existing && this.#devices.size >= MAX_DEVICES) {
      // The device not heard from for longest goes.
      const [oldest] = this.#devices.keys()
      if (oldest) this.#forget(oldest)
    }

    const device: Device = existing ?? {
      settings,
      since: new Map(),
      lastSent: new Map(),
      pending: new Map(),
      known: new Set(),
      sentTimes: [],
      unseen: 0
    }
    device.settings = settings
    for (const word of settings.words) if (!device.since.has(word)) device.since.set(word, now)
    for (const word of [...device.since.keys()]) {
      if (!settings.words.includes(word)) {
        device.since.delete(word)
        device.pending.delete(word)
      }
    }

    // Most recently heard from last, for the eviction above.
    this.#devices.delete(endpoint)
    this.#devices.set(endpoint, device)
  }

  // The device's own quiet hours, or its profile's that the server knows.
  #quiet(device: Device, now: number) {
    const { profileId } = device.settings
    return inQuietHours(device.settings, now) || (profileId !== undefined && !this.#mayNotify(profileId, now))
  }

  unregister(endpoint: string) {
    this.#forget(endpoint)
  }

  // A deleted profile's devices are told nothing more.
  unregisterProfile(profileId: number) {
    for (const [endpoint, device] of this.#devices) {
      if (device.settings.profileId === profileId) this.#forget(endpoint)
    }
  }

  // The reader opened "Suivis": the icon's count starts again from zero.
  markSeen(endpoint: string) {
    const device = this.#devices.get(endpoint)
    if (device) device.unseen = 0
  }

  // An article sent to a profile by another one, or a reaction to one it sent: its devices that want it are told
  // at once, outside quiet hours. Missed then, it still waits in "Partages".
  async notifyShare(profileId: number, payload: AlertPayload, kind: 'shares' | 'reactions' = 'shares') {
    const now = this.#now()
    const devices = [...this.#devices.entries()].filter(
      ([, device]) =>
        device.settings.profileId === profileId && device.settings[kind] !== false && !this.#quiet(device, now)
    )
    await Promise.all(
      devices.map(async ([endpoint, device]) => {
        try {
          await this.#send(device.settings.target, payload)
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode
          if (status === 404 || status === 410) this.#forget(endpoint)
          else this.#log(`Share alert: push failed (${status ?? 'network'})`)
        }
      })
    )
  }

  start() {
    this.#timer ??= setInterval(() => void this.check(), CHECK_INTERVAL_MS)
    this.#timer.unref()
  }

  stop() {
    if (this.#timer) clearInterval(this.#timer)
    this.#timer = null
  }

  // Looks for new articles and sends what is due. Feeds are fetched only when a device follows something.
  async check() {
    if (![...this.#devices.values()].some(device => device.settings.words.length > 0)) return
    this.#running ??= this.#check().finally(() => {
      this.#running = null
    })
    return this.#running
  }

  async #check() {
    let items: FeedItem[]
    try {
      items = await this.#listItems()
    } catch (error) {
      this.#log(`Followed alerts: listing failed: ${error instanceof Error ? error.message : String(error)}`)
      return
    }

    const now = this.#now()
    const texts = new Map(items.map(item => [item.id, foldText(`${item.title} ${item.summary}`)]))

    await Promise.all(
      [...this.#devices.entries()].map(async ([endpoint, device]) => {
        this.#collect(device, items, texts, now)
        const payloads = this.#due(device, now)

        for (const payload of payloads) {
          try {
            await this.#send(device.settings.target, payload)
          } catch (error) {
            const status = (error as { statusCode?: number }).statusCode
            // The browser dropped the subscription: forget the device.
            if (status === 404 || status === 410) {
              this.#forget(endpoint)
              return
            }
            this.#log(`Followed alerts: push failed (${status ?? 'network'})`)
          }
        }
      })
    )
  }

  // New articles about each subject wait in pending until they can be announced.
  #collect(device: Device, items: FeedItem[], texts: Map<string, string>, now: number) {
    const { settings } = device
    const muted = settings.mutedWords.map(wordPattern)

    for (const word of settings.words) {
      const pattern = wordPattern(word)
      const since = Math.max(device.since.get(word) ?? now, now - MAX_ARTICLE_AGE_MS)

      for (const item of items) {
        const text = texts.get(item.id) ?? ''
        const publishedAt = item.publishedAt ? Date.parse(item.publishedAt) : NaN
        if (
          device.known.has(item.id) ||
          !(publishedAt >= since) ||
          settings.hiddenSources.includes(item.sourceId) ||
          !pattern.test(text) ||
          muted.some(mute => mute.test(text))
        ) {
          continue
        }

        device.known.add(item.id)
        device.unseen++
        const pending = device.pending.get(word) ?? { items: [] }
        pending.items.push(item)
        device.pending.set(word, pending)
      }
    }

    if (device.known.size > MAX_KNOWN_IDS) device.known = new Set([...device.known].slice(-MAX_KNOWN_IDS / 2))
  }

  #due(device: Device, now: number): AlertPayload[] {
    if (this.#quiet(device, now)) return []

    device.sentTimes = device.sentTimes.filter(time => time > now - 24 * HOUR_MS)
    const payloads: AlertPayload[] = []

    for (const [word, pending] of device.pending) {
      if (device.sentTimes.length >= MAX_ALERTS_PER_DAY) break
      if (now - (device.lastSent.get(word) ?? 0) < SUBJECT_COOLDOWN_MS) continue

      const items = [...pending.items].sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
      const [latest] = items
      if (!latest) continue

      // The newest article: its title, then the start of its text, as a news app shows it (iOS puts the
      // app's icon and name above). Without a text, its source.
      const others = items.length - 1
      payloads.push({
        title: latest.title,
        body: latest.summary ? truncate(latest.summary, PREVIEW_LENGTH) : latest.sourceName,
        url: others === 0 ? `#/article/${latest.id}` : '#/suivis',
        tag: `followed:${word}`,
        badge: device.settings.badge ? device.unseen : null
      })
      device.pending.delete(word)
      device.lastSent.set(word, now)
      device.sentTimes.push(now)
    }

    return payloads
  }
}
