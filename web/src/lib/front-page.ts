import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { type FrontPageSection, getFrontPage } from '../api.ts'
import { useLanguage } from './i18n.ts'
import { isHidden, usePreferences } from './preferences.ts'
import { rememberRelated } from './related.ts'
import { loadDailySummary } from './daily-summary.ts'
import { sendPendingChanges } from './user-state.ts'

// "À la une": the three most covered stories of each topic, kept for the visit.
const STALE_AFTER_MS = 10 * 60 * 1000

let sections: FrontPageSection[] | null = null
// Asked once, answered or not: the lists wait for it, so that its row does not come in above them later.
let settled = false
let loadedAt = 0
let pending: Promise<void> | null = null
// The hidden sources and muted words the stories were picked with, by the server.
let pickedWith: string | null = null
// The language the topics are named in, by the server.
let namedIn: string | null = null
const listeners = new Set<() => void>()

// With the last daily summary, whose bubble heads the row: the row comes whole, its circles do not move after.
const load = () =>
  (pending ??= Promise.all([getFrontPage(), loadDailySummary().catch(() => {})])
    .then(([next]) => {
      next.forEach(section =>
        rememberRelated(section.items.map(item => ({ ...item, topicId: section.id, topicLabel: section.label })))
      )
      sections = next
      loadedAt = Date.now()
      listeners.forEach(listener => listener())
    })
    .catch(() => {})
    .finally(() => {
      pending = null
      if (!settled) {
        settled = true
        listeners.forEach(listener => listener())
      }
    }))

// False until "À la une" was asked once (and its first load started: call with useFrontPage).
export const useFrontPageSettled = () =>
  useSyncExternalStore(
    listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => settled
  )

export const useFrontPage = () => {
  const value = useSyncExternalStore(
    listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => sections
  )

  useEffect(() => {
    if (Date.now() - loadedAt > STALE_AFTER_MS) void load()
  }, [])

  // The server leaves out what the profile turned off, giving its place to another story:
  // asked again when that changes, and hidden here in the meantime.
  const preferences = usePreferences()
  const filterKey = JSON.stringify([preferences.hiddenSources, preferences.mutedWords])
  useEffect(() => {
    if (pickedWith !== null && pickedWith !== filterKey) void load()
    pickedWith = filterKey
  }, [filterKey])

  // The server names the topics in the profile's language: asked again in a new one, once the server knows it.
  const language = useLanguage()
  useEffect(() => {
    if (namedIn !== null && namedIn !== language) void sendPendingChanges().then(load)
    namedIn = language
  }, [language])

  return useMemo(
    () =>
      value?.map(section => ({
        ...section,
        items: section.items.filter(item => !isHidden(item, { ...preferences, hideRead: false }))
      })) ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [value, filterKey]
  )
}
