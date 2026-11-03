import { useEffect, useState } from 'react'

// Hash routes keep the back button working without any server-side routing:
// #/ (À la une), #/belgique (a topic), #/article/<id> (the reader), #/videos/<id> (videos and podcasts; #/ecouter, its old name, still opens),
// #/plus-tard (saved articles), #/recherche/<words> (search), #/suivis (followed subjects), #/partages (sent by the household),
// #/reglages/<section>[/<item>] (settings; #/reglages/demandes/<id>, a teen's request; #/sources and #/stats are two of its sections), #/resume (Résumé du jour),
// #/une/<topic> (À la une, as stories), #/historique (the last 7 days' reading), #/profils ("Qui lit ?").
export type Route =
  | { name: 'frontPage' }
  | { name: 'topic'; topicId: string }
  | { name: 'article'; articleId: string }
  // itemId null: the list alone (phone), nothing open yet (computer).
  | { name: 'listen'; itemId: string | null }
  | { name: 'saved' }
  | { name: 'search'; query: string }
  | { name: 'followed' }
  | { name: 'shares' }
  // section null: the list of sections (phone), the first one (computer). item: one thing of the section
  // (#/reglages/profils/<id>, a young profile's page for its parents).
  | { name: 'settings'; section: SettingsSection | null; item?: string; request?: number }
  | { name: 'dailySummary' }
  | { name: 'story'; topicId: string }
  | { name: 'history' }
  | { name: 'profiles' }

export const SETTINGS_SECTIONS = [
  'reading',
  'themes',
  'sources',
  'followed',
  'muted',
  'notifications',
  'me',
  'stats',
  'sharing',
  'household',
  'profiles',
  'ai',
  'account',
  'shortcuts',
  'about'
] as const
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

// The section names in the address, in French like the rest of it.
const SECTION_SLUGS: Record<SettingsSection, string> = {
  reading: 'lecture',
  themes: 'themes',
  sources: 'sources',
  followed: 'suivis',
  muted: 'masques',
  notifications: 'notifications',
  me: 'moi',
  stats: 'stats',
  ai: 'ia',
  household: 'foyer',
  profiles: 'profils',
  sharing: 'partage',
  account: 'compte',
  shortcuts: 'raccourcis',
  about: 'a-propos'
}

const sectionOf = (slug: string) => SETTINGS_SECTIONS.find(section => SECTION_SLUGS[section] === slug) ?? null

export const parseRoute = (hash: string): Route => {
  const [first = '', second = '', third = ''] = hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent)

  if (!first) return { name: 'frontPage' }
  if (first === 'article' && second) return { name: 'article', articleId: second }
  if (first === 'sources') return { name: 'settings', section: 'sources' }
  if (first === 'videos' || first === 'ecouter') return { name: 'listen', itemId: second || null }
  if (first === 'plus-tard') return { name: 'saved' }
  if (first === 'recherche') return { name: 'search', query: second }
  // A teen's request, opened from its notification or the pile on top of Réglages.
  if (first === 'reglages' && second === 'demandes' && /^\d+$/.test(third))
    return { name: 'settings', section: null, request: Number(third) }
  if (first === 'reglages') return { name: 'settings', section: sectionOf(second), ...(third ? { item: third } : {}) }
  if (first === 'suivis') return { name: 'followed' }
  if (first === 'partages') return { name: 'shares' }
  if (first === 'stats') return { name: 'settings', section: 'stats' }
  if (first === 'resume') return { name: 'dailySummary' }
  if (first === 'historique') return { name: 'history' }
  if (first === 'profils') return { name: 'profiles' }
  if (first === 'une' && second) return { name: 'story', topicId: second }

  return { name: 'topic', topicId: first }
}

export const topicHref = (topicId: string) => `#/${encodeURIComponent(topicId)}`
export const articleHref = (articleId: string) => `#/article/${encodeURIComponent(articleId)}`
export const FRONT_PAGE_HREF = '#/'
export const LISTEN_HREF = '#/videos'
export const watchHref = (itemId: string) => `#/videos/${encodeURIComponent(itemId)}`
export const SAVED_HREF = '#/plus-tard'
export const searchHref = (query = '') => `#/recherche/${encodeURIComponent(query)}`
export const SETTINGS_HREF = '#/reglages'
export const settingsHref = (section: SettingsSection) => `#/reglages/${SECTION_SLUGS[section]}`
export const requestHref = (id: number) => `#/reglages/demandes/${id}`
// A young profile's page, for its parents.
export const youngProfileHref = (id: number) => `${settingsHref('profiles')}/${id}`
export const FOLLOWED_HREF = '#/suivis'
export const SHARES_HREF = '#/partages'
export const DAILY_SUMMARY_HREF = '#/resume'
export const HISTORY_HREF = '#/historique'
// On a computer the article open stays beside the next list: this event closes it.
export const CLOSE_READER = 'hodi:close-reader'
export const PROFILES_HREF = '#/profils'
export const storyHref = (topicId: string) => `#/une/${encodeURIComponent(topicId)}`

export const useHashRoute = () => {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash))

  useEffect(() => {
    const handleChange = () => setRoute(parseRoute(window.location.hash))

    window.addEventListener('hashchange', handleChange)
    return () => window.removeEventListener('hashchange', handleChange)
  }, [])

  return route
}
