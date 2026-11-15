// The reader's state (preferences, "Enregistrés", read articles, reading stats), kept on the server and
// shared by every device. This device keeps a copy to start instantly and to work offline: changes show
// at once, are sent in the background, and wait in an outbox while the network is down.
// Nothing polls: the state is fetched again only when the app comes back to the foreground.

import { t } from './i18n.ts'
import { showError, showInfo, showSaved } from './toast.ts'

export interface StoredSavedEntry {
  item: { id: string } & Record<string, unknown>
  savedAt: string
}

export interface StoredReading {
  id: string
  sourceId: string
  sourceName: string
  topicId: string | null
  minutes: number
  at: number
  // Left out before videos counted: an article.
  kind?: 'article' | 'video' | 'podcast'
  // Articles opened since it was tracked (see reading-stats.ts). Left out: counted as read.
  done?: boolean
  progress?: number
  position?: number
  estimate?: number
}

export interface UserState {
  revision: number
  preferences: Record<string, unknown> | null
  saved: StoredSavedEntry[]
  // Newest first.
  read: string[]
  // Read articles hidden from the lists without being opened. Missing from copies kept before it existed.
  hidden?: string[]
  readings: StoredReading[]
}

interface Change {
  method: 'PUT' | 'POST' | 'PATCH' | 'DELETE'
  path: string
  body?: unknown
  // A setting: "Réglage enregistré" once the server has it.
  setting?: boolean
}

const CACHE_KEY = 'hodi:user-state'
const OUTBOX_KEY = 'hodi:user-outbox'
// Keys of the browser-only storage used before the server kept the state: imported once, then removed.
const LEGACY_KEYS = {
  preferences: 'hodi:preferences',
  saved: 'hodi:saved',
  read: 'hodi:read',
  readings: 'hodi:reading-stats'
} as const
// Coming back to the app after this long fetches the state again (a cheap request when nothing changed).
const REFRESH_AFTER_MS = 60 * 1000
const MAX_READ = 5000

const EMPTY: UserState = { revision: 0, preferences: null, saved: [], read: [], hidden: [], readings: [] }

const readJson = (key: string): unknown => {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? undefined : (JSON.parse(raw) as unknown)
  } catch {
    return undefined
  }
}

const writeJson = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private browsing or full storage: the server still has everything.
  }
}

const array = (value: unknown) => (Array.isArray(value) ? (value as unknown[]) : [])

// What the browser kept before the server did: shown until the import is done, so nothing flashes away.
const legacyState = (): (UserState & { saved: (StoredSavedEntry & { article?: unknown })[] }) | null => {
  const preferences = readJson(LEGACY_KEYS.preferences)
  const saved = array(readJson(LEGACY_KEYS.saved)) as (StoredSavedEntry & { article?: unknown })[]
  const read = array(readJson(LEGACY_KEYS.read)).filter((id): id is string => typeof id === 'string')
  const readings = array(readJson(LEGACY_KEYS.readings)) as StoredReading[]

  if (preferences === undefined && saved.length === 0 && read.length === 0 && readings.length === 0) return null

  return {
    revision: 0,
    preferences:
      typeof preferences === 'object' && preferences !== null ? (preferences as Record<string, unknown>) : null,
    saved: saved.filter(entry => typeof entry?.item?.id === 'string'),
    // The old list was oldest first.
    read: [...read].reverse(),
    readings: readings.map(reading => ({ ...reading, topicId: reading.topicId ?? null }))
  }
}

const legacy = legacyState()
let state: UserState = (readJson(CACHE_KEY) as UserState | undefined) ?? legacy ?? EMPTY
let outbox: Change[] = array(readJson(OUTBOX_KEY)) as Change[]
let lastRefresh = 0
let flushing: Promise<void> | null = null
// Whether this time offline was already told.
let toldOffline = false
const listeners = new Set<() => void>()
// Told when the outbox is empty again after sending something: what waited offline is now on the server.
const sentListeners = new Set<() => void>()

const notify = () => listeners.forEach(listener => listener())

const commit = (next: UserState) => {
  state = next
  writeJson(CACHE_KEY, state)
  notify()
}

export const getUserState = () => state

export const subscribeUserState = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// One change to the server; null when the network is away, and the change is kept here and leaves with the network.
const sendChange = async (change: (typeof outbox)[number]) => {
  try {
    return await fetch(`/api/me${change.path}`, {
      method: change.method,
      headers: change.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: change.body === undefined ? undefined : JSON.stringify(change.body)
    })
  } catch {
    // Once per time offline.
    if (!navigator.onLine && !toldOffline) {
      toldOffline = true
      showInfo(t('sync.offline'))
    }
    return null
  }
}

const afterSent = async (change: (typeof outbox)[number], response: Response) => {
  if (change.setting) showSaved()
  const { revision } = (await response.json().catch(() => ({}))) as { revision?: number }
  // Exactly one change since our copy: it is ours, and our copy is up to date.
  if (typeof revision === 'number' && revision === state.revision + 1) commit({ ...state, revision })
  else lastRefresh = 0
}

// Sends the waiting changes in order. A change the server refuses is dropped; a network error keeps it for later.
const sendOutbox = async () => {
  let sent = false
  while (outbox.length > 0) {
    const change = outbox[0]!
    const response = await sendChange(change)
    // Logged out: the changes wait for the next session.
    if (!response || response.status === 401) return

    outbox = outbox.slice(1)
    writeJson(OUTBOX_KEY, outbox)
    if (!response.ok) {
      showError(t('sync.refused'), undefined, 'sync-refused')
      continue
    }
    sent = true
    await afterSent(change, response)
  }
  if (sent) sentListeners.forEach(listener => listener())
}

export const subscribeChangesSent = (listener: () => void) => {
  sentListeners.add(listener)
  return () => sentListeners.delete(listener)
}

// One sending at a time. Cleared in a later tick: with nothing to send the sending ends at once, and clearing
// it inside would happen before it is even stored, leaving it set for good and every later change unsent.
const flush = () => {
  flushing ??= sendOutbox().finally(() => {
    flushing = null
  })
  return flushing
}

// Sends what waits now. False: some changes are still on this device (offline).
export const sendPendingChanges = async () => {
  await flush()
  return outbox.length === 0
}

// Applies a change here at once, and queues it for the server.
// Consecutive "read" changes travel together: opening ten articles sends one request (hiding ones apart).
export const changeUserState = (update: (current: UserState) => UserState, change: Change) => {
  commit(update(state))

  const last = outbox.at(-1)
  if (
    change.method === 'POST' &&
    change.path === '/read' &&
    last?.method === 'POST' &&
    last.path === '/read' &&
    (last.body as { hidden?: boolean }).hidden === (change.body as { hidden?: boolean }).hidden &&
    outbox.length > 1
  ) {
    const ids = [...(last.body as { ids: string[] }).ids, ...(change.body as { ids: string[] }).ids].slice(-300)
    outbox = [...outbox.slice(0, -1), { ...last, body: { ids } }]
  } else if (change.method === 'PATCH' && last?.method === 'PATCH' && last.path === change.path && outbox.length > 1) {
    // Only the latest progress of an article matters.
    outbox = [...outbox.slice(0, -1), change]
  } else {
    outbox = [...outbox, change]
  }
  writeJson(OUTBOX_KEY, outbox)
  void flush()
}

// Fetches the server's state, unless this device already has its revision.
export const refreshUserState = async () => {
  lastRefresh = Date.now()
  await flush()
  if (outbox.length > 0) return

  try {
    const response = await fetch(`/api/me?since=${state.revision}`)
    if (response.status !== 200) return
    const next = (await response.json()) as UserState
    commit({ ...next, read: next.read.slice(0, MAX_READ), hidden: next.hidden ?? [] })
  } catch {
    // Offline: the copy on this device stands.
  }
}

// What this browser kept before the server did joins the server's state, once.
const importLegacy = async () => {
  if (!legacy) return

  const response = await fetch('/api/me/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      preferences: legacy.preferences ?? undefined,
      saved: legacy.saved,
      read: [...legacy.read].reverse(),
      readings: legacy.readings
    })
  }).catch(() => null)

  if (!response?.ok) return
  Object.values(LEGACY_KEYS).forEach(key => {
    try {
      localStorage.removeItem(key)
    } catch {
      // Nothing to clean up.
    }
  })
}

let started = false

// Called once the session is known: imports the old local data, fetches the state, then refreshes it
// whenever the app comes back to the foreground or the network comes back.
export const startUserStateSync = () => {
  if (started) return
  started = true

  void importLegacy().then(refreshUserState)

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastRefresh > REFRESH_AFTER_MS) void refreshUserState()
  })
  window.addEventListener('online', () => {
    toldOffline = false
    void refreshUserState()
  })
}

// Logging out leaves nothing of the reader's state on the device.
export const clearUserState = () => {
  outbox = []
  commit(EMPTY)
  ;[CACHE_KEY, OUTBOX_KEY, 'hodi:saved-texts'].forEach(key => {
    try {
      localStorage.removeItem(key)
    } catch {
      // Nothing to clean up.
    }
  })
}
