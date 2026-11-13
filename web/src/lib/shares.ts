import { useEffect, useSyncExternalStore } from 'react'
import {
  type Reaction,
  type ShareEntry,
  type ShareReaction,
  UnauthorizedError,
  getShareReactions,
  getShareTargets,
  getShares,
  markShareReactionsSeen,
  reactToShare
} from '../api.ts'
import { usePreferences } from './preferences.ts'
import { useProfiles } from './profiles.ts'
import { isRead, useReadState } from './read-state.ts'
import { sendPendingChanges } from './user-state.ts'

// "Partages": the articles the household's other profiles sent here. The list and the counter beside
// "Partages" share one result; it is fetched when the app opens and when it comes back to the foreground.

let entries: ShareEntry[] | null = null
// The reactions to what this profile sent, not seen in "Partages" yet; and up to when they were seen here.
let reactions: ShareReaction[] = []
let reactionsSeenUntil = 0
let failed = false
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

const notify = () => listeners.forEach(listener => listener())

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// Asked while a request runs: asked again after it, the settings may have changed in between.
let again = false

// Settings changed just before (who to receive from) go first: the server filters the shares with them.
export const refreshShares = (onUnauthorized?: () => void): Promise<void> => {
  if (loading) {
    again = true
    return loading
  }
  loading = sendPendingChanges()
    .then(() =>
      Promise.all([
        getShares(),
        getShareReactions()
          .then(({ items }) => items)
          .catch(() => reactions)
      ])
    )
    .then(([{ items }, found]) => {
      reactions = found
      // Read ones too: "Partages" hides them under "Masquer les articles lus", as the other lists do.
      entries = items
      failed = false
    })
    .catch((error: unknown) => {
      if (error instanceof UnauthorizedError) onUnauthorized?.()
      else failed = entries === null
    })
    .finally(() => {
      loading = null
      notify()
      if (again) {
        again = false
        void refreshShares(onUnauthorized)
      }
    })
  return loading
}

// The share of an article open in the reader, from the list the counter keeps. Read, it stays while the reader
// is open, for the reaction sent back. Opened straight from a link, before any list (a phone hides its bar
// there), the list is asked for once.
export const useShareOf = (articleId: string) => {
  const shown = useSharingShown()
  const value = useSyncExternalStore(subscribe, () => entries)

  useEffect(() => {
    if (shown && entries === null) void refreshShares()
  }, [shown])
  return shown ? (value?.find(entry => entry.item.id === articleId) ?? null) : null
}

// An emoji back to the sender, shown at once; put back as it was if the server refuses it.
export const reactTo = async (entry: ShareEntry, reaction: Reaction | null) => {
  const set = (value: Reaction | null) => {
    entries = (entries ?? []).map(other =>
      other.item.id === entry.item.id && other.from === entry.from ? { ...other, reaction: value } : other
    )
    notify()
  }
  const before = entry.reaction
  set(reaction)
  try {
    await reactToShare(entry.item.id, entry.from, reaction)
  } catch {
    set(before)
  }
}

// The reactions not seen yet, newest first.
export const useShareReactions = () => useSyncExternalStore(subscribe, () => reactions)

// Seen in "Partages": the server forgets them, the badge goes. The lines stay on screen until it closes.
export const seeShareReactions = (until: number) => {
  if (until <= reactionsSeenUntil) return
  reactionsSeenUntil = until
  notify()
  void markShareReactionsSeen(until).catch(() => {})
}

// The badge of "Partages" when nothing sent is left to open: the last emoji received, until "Partages" opens.
export const useLastReaction = () => {
  const shown = useSharingShown()
  const value = useSyncExternalStore(subscribe, () => reactions)
  const seenUntil = useSyncExternalStore(subscribe, () => reactionsSeenUntil)
  const last = value
    .filter(entry => entry.reactedAt > seenUntil)
    .reduce<ShareReaction | null>(
      (latest, entry) => (!latest || entry.reactedAt > latest.reactedAt ? entry : latest),
      null
    )
  return shown ? (last?.reaction ?? null) : null
}

// "Partages" shows once the household has another profile, unless this one turned sharing off.
export const useSharingShown = () => {
  const preferences = usePreferences()
  const profiles = useProfiles({ onError: () => {} })
  return preferences.sharing && (profiles?.profiles.length ?? 0) > 1
}

export const useShares = (onUnauthorized?: () => void) => {
  const shown = useSharingShown()
  // "Recevoir de X" turned on or off: the list and the counter follow at once.
  const muted = usePreferences().mutedSharers.join(',')
  const value = useSyncExternalStore(subscribe, () => entries)
  const error = useSyncExternalStore(subscribe, () => failed)

  useEffect(() => {
    if (!shown) return
    void refreshShares(onUnauthorized)
    const visible = () => {
      if (document.visibilityState === 'visible') void refreshShares(onUnauthorized)
    }
    document.addEventListener('visibilitychange', visible)
    return () => document.removeEventListener('visibilitychange', visible)
  }, [shown, muted, onUnauthorized])

  return { entries: shown ? value : [], error: shown && error }
}

// The counter beside "Partages": what was sent and not opened yet.
export const useSharesUnread = () => {
  useReadState()
  const { entries: shares } = useShares()
  return (shares ?? []).filter(entry => !isRead(entry.item.id)).length
}

// Who "Pour…" can send to: kept between articles, asked again each time one opens (a profile may have turned
// sharing on or off meanwhile). Nobody: the button is hidden.
let targets: number[] | null = null
let targetsLoading: Promise<void> | null = null

const refreshTargets = () => {
  targetsLoading ??= getShareTargets()
    .then(next => {
      targets = next
    })
    .catch(() => {})
    .finally(() => {
      targetsLoading = null
      notify()
    })
}

export const useShareTargets = () => {
  const shown = useSharingShown()
  const value = useSyncExternalStore(subscribe, () => targets)

  useEffect(() => {
    if (shown) refreshTargets()
  }, [shown])

  return shown ? (value ?? []) : []
}
