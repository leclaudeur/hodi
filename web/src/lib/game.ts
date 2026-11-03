import { useEffect, useSyncExternalStore } from 'react'
import { type GameNews, type HouseholdGame, getHouseholdGame, markGameSeen, setGameEnabled } from '../api.ts'
import { currentProfileId } from './profiles.ts'
import { subscribeChangesSent } from './user-state.ts'

// The household game: whether it is on, and each profile's level and badge for its avatar. Fetched when the app
// opens, when it comes back to the foreground (as "Partages") and after a read; a sheet asks again when it opens.

let game: HouseholdGame | null = null
// When news last showed for the first time on this device: the avatar celebrates it once, then keeps its sparkle.
let arrivedAt = 0
// When an avatar first played that celebration, 0 until one did.
let playedAt = 0
// Avatars that mount together (a page's header and its sidebar) celebrate together.
const TOGETHER_MS = 500

// The news already celebrated on this device, newest last: the same news never celebrates twice, even after a
// reload, while news earned with the app closed still celebrates when the app opens.
const CELEBRATED_KEY = 'hodi:game-celebrated'
const celebrateOnce = (news: string) => {
  // Each profile of the device celebrates its own news.
  const key = `${currentProfileId() ?? ''}:${news}`
  try {
    const seen = JSON.parse(localStorage.getItem(CELEBRATED_KEY) ?? '[]') as string[]
    if (seen.includes(key)) return false
    localStorage.setItem(CELEBRATED_KEY, JSON.stringify([...seen, key].slice(-10)))
    return true
  } catch {
    // Private window: only news arriving while the app is open celebrates.
    return game !== null
  }
}
// Once the profile has seen its news (or a test reset cleared it), the same tier cannot come back as news except
// after a reset: forgetting this profile's celebrations then lets a reseeded tier celebrate again.
const forgetCelebrated = () => {
  const prefix = `${currentProfileId() ?? ''}:`
  try {
    const seen = JSON.parse(localStorage.getItem(CELEBRATED_KEY) ?? '[]') as string[]
    const kept = seen.filter(key => !key.startsWith(prefix))
    if (kept.length !== seen.length) localStorage.setItem(CELEBRATED_KEY, JSON.stringify(kept))
  } catch {
    // Private window: nothing kept.
  }
}

// Whether the game was on at the last answer, kept on this device: while the first answer is on its way, an avatar
// shows an empty ring (which then fills) rather than its full colour ring (which then emptied at once).
const ON_KEY = 'hodi:game-on'
const wasOn = () => {
  try {
    return localStorage.getItem(ON_KEY) === '1'
  } catch {
    return false
  }
}
const rememberOn = (on: boolean) => {
  try {
    localStorage.setItem(ON_KEY, on ? '1' : '0')
  } catch {
    // Private window: the colour ring shows until the answer, as before.
  }
}
let loading: Promise<void> | null = null
let watchers = 0
const listeners = new Set<() => void>()

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const refreshGame = () => {
  loading ??= getHouseholdGame()
    .then(next => {
      const key = newsKey(next.news)
      if (key === '') forgetCelebrated()
      else if (key !== newsKey(game?.news) && celebrateOnce(key)) {
        arrivedAt = Date.now()
        playedAt = 0
      }
      game = next
      rememberOn(next.enabled)
      listeners.forEach(listener => listener())
    })
    .catch(() => {})
    .finally(() => {
      loading = null
    })
  return loading
}

// A read that earns points waits to be on the server, maybe for the network to come back: the ring and the bar
// follow once it is there, without waiting for the next foreground. Several reads in a row ask once.
let earned = false

export const refreshGameSoon = () => {
  if (game?.enabled === false) return
  earned = true
}

// Also when the game could not be fetched yet (the app opened offline).
subscribeChangesSent(() => {
  if (!earned && game) return
  earned = false
  void refreshGame()
})

const visible = () => {
  if (document.visibilityState === 'visible') void refreshGame()
}

// On a computer, coming back from another window leaves the page visible all along: the window's focus says it.
const focused = () => void refreshGame()

// null while unknown. active false: neither fetched nor watched (an avatar outside the game).
const useGame = (active: boolean) => {
  const value = useSyncExternalStore(subscribe, () => game)
  useEffect(() => {
    if (!active) return
    if (!game) void refreshGame()
    // One listener for the whole app, however many avatars ask.
    if (watchers++ === 0) {
      document.addEventListener('visibilitychange', visible)
      window.addEventListener('focus', focused)
    }
    return () => {
      if (--watchers > 0) return
      document.removeEventListener('visibilitychange', visible)
      window.removeEventListener('focus', focused)
    }
  }, [active])
  return active ? value : null
}

// null while unknown or turned off.
export const useHouseholdGame = (active = true) => {
  const value = useGame(active)
  return value?.enabled ? value : null
}

// The admin's switch (Réglages > Foyer): null while unknown.
export const useGameEnabled = () => useGame(true)?.enabled ?? null

export const switchGame = async (enabled: boolean) => {
  await setGameEnabled(enabled)
  await refreshGame()
}

// A profile's level and badge, for its avatar; null when the game is off, or for no profile. 'loading' while the
// first answer is on its way in a household where the game was on.
export const useProfileGame = (profileId: number | null) => {
  const value = useGame(profileId !== null)
  if (profileId === null) return null
  if (value === null) return wasOn() ? 'loading' : null
  if (!value.enabled) return null
  return value.ranking.find(entry => entry.profileId === profileId) ?? null
}

const newsKey = (news: GameNews | undefined) =>
  news && (news.level !== null || news.badges.length > 0)
    ? [news.since ?? '', news.level ?? '', ...news.badges.map(badge => `${badge.id}${badge.tier}`)].join(' ')
    : ''

export const hasNews = (news: GameNews | null | undefined) => newsKey(news ?? undefined) !== ''

// What the profile in use earned since it last opened its sheet; null when nothing, or when the game is off.
// arrived: the moment it first showed on this device, 0 when it was already celebrated.
export const useGameNews = (active: boolean) => {
  const value = useHouseholdGame(active)
  return value && hasNews(value.news) ? { news: value.news, arrived: arrivedAt } : null
}

// Whether an avatar mounting with this news plays its celebration: the first ones to show it. On a phone no avatar
// shows while an article is open: the news found after a read then celebrates once back where the avatar is.
export const claimCelebration = (arrived: number) => {
  if (arrived === 0 || arrived !== arrivedAt) return false
  playedAt ||= Date.now()
  return Date.now() - playedAt < TOGETHER_MS
}

// One's own sheet showed it: no longer new, on every avatar.
export const seeGameNews = async () => {
  await markGameSeen()
  // A refresh asked before the mark would still bring the news back: ask again once it is done.
  await loading
  await refreshGame()
}
