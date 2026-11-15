import { useSyncExternalStore } from 'react'
import { changeUserState, getUserState, subscribeUserState } from './user-state.ts'

// Read articles, kept on the server and shared by every device (see user-state.ts).

// Built again only when the state changes.
let source: string[] | null = null
let readIds = new Set<string>()
const current = () => {
  const stored = getUserState().read
  if (stored !== source) {
    source = stored
    readIds = new Set(stored)
  }
  return readIds
}

let hiddenSource: string[] | undefined
let hiddenIds = new Set<string>()
const hidden = () => {
  const stored = getUserState().hidden
  if (stored !== hiddenSource) {
    hiddenSource = stored
    hiddenIds = new Set(stored)
  }
  return hiddenIds
}

// The article open now: read, yet still listed under "Masquer les articles lus" until it is closed,
// so the list beside it on a computer doesn't jump.
let open: string | null = null
const openListeners = new Set<() => void>()
const setOpen = (id: string | null) => {
  if (open === id) return
  open = id
  for (const listener of openListeners) listener()
}

export const isRead = (id: string) => current().has(id) || id === open

export const isReadAndClosed = (id: string) => current().has(id) && id !== open

// The reader closed this article, or moved on to another: the lists hide it from now on.
export const closeArticle = (id: string) => {
  if (open === id) setOpen(null)
}

// open: it opens in the reader, which closes it. A link to the site or a video is done with at once.
export const markRead = (id: string, open = true) => {
  if (open) setOpen(id)
  if (current().has(id)) return

  changeUserState(state => ({ ...state, read: [id, ...state.read] }), {
    method: 'POST',
    path: '/read',
    body: { ids: [id] }
  })
}

// Put away without opening it (a swipe, "Masquer"): gone from every list, whatever "Masquer les articles lus"
// says, until it is brought back from the history. Not a reading: the stats don't count it.
export const isDismissed = (id: string) => hidden().has(id)

export const dismissArticle = (id: string) => {
  if (hidden().has(id)) return
  changeUserState(
    state => ({
      ...state,
      read: state.read.includes(id) ? state.read : [id, ...state.read],
      hidden: [id, ...(state.hidden ?? [])]
    }),
    { method: 'POST', path: '/read', body: { ids: [id], hidden: true } }
  )
}

// "Historique": back to unread, as if never opened (its reading still counts in the stats).
export const markUnread = (id: string) => {
  if (!current().has(id)) return
  changeUserState(
    state => ({
      ...state,
      read: state.read.filter(other => other !== id),
      hidden: (state.hidden ?? []).filter(other => other !== id)
    }),
    { method: 'DELETE', path: `/read/${encodeURIComponent(id)}` }
  )
}

// "Effacer l'historique": every article unread again, on every device.
export const clearRead = () =>
  changeUserState(state => ({ ...state, read: [], hidden: [] }), { method: 'DELETE', path: '/read' })

// One value for the read, hidden and open articles together, built again only when one of them changes.
let snapshot: { ids: Set<string>; hidden: Set<string>; open: string | null } = {
  ids: current(),
  hidden: hidden(),
  open
}
const readSnapshot = () => {
  const ids = current()
  const hiddenNow = hidden()
  if (ids !== snapshot.ids || hiddenNow !== snapshot.hidden || open !== snapshot.open)
    snapshot = { ids, hidden: hiddenNow, open }
  return snapshot
}

const subscribe = (listener: () => void) => {
  const unsubscribe = subscribeUserState(listener)
  openListeners.add(listener)
  return () => {
    unsubscribe()
    openListeners.delete(listener)
  }
}

// Re-renders when an article is marked read, here or on another device, or closed.
export const useReadState = () => useSyncExternalStore(subscribe, readSnapshot)
