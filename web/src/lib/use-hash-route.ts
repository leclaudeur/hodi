import { useEffect, useState } from 'react'
import { RENAMED_TOPICS } from './renamed-topics.ts'

// Hash routes keep the back button working without any server-side routing. Addresses are in English:
// #/ (À la une), #/belgium (a topic, by its id), #/article/<id> (the reader), #/videos/<id> (videos and podcasts),
// #/saved (saved articles), #/search/<words> (search), #/followed (followed subjects), #/shares (sent by the household),
// #/settings/<section>[/<item>] (settings; #/settings/requests/<id>, a teen's request), #/summary (Résumé du jour),
// #/stories/<topic> (À la une, as stories), #/history (the last 7 days' reading), #/profiles ("Qui lit ?"),
// #/server/<section>[/<item>] (the server's admin space; #/server/plugin/<id>/<section>[/<path>], a plugin's section).
// The French addresses of earlier versions still open: see LEGACY_PATHS and RENAMED_TOPICS.
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
  // (#/settings/profiles/<id>, a young profile's page for its parents). path: what follows it, a plugin's own
  // screens under its page (#/settings/plugin/<id>/<path>).
  | { name: 'settings'; section: SettingsSection | null; item?: string; path?: string; request?: number }
  | { name: 'dailySummary' }
  | { name: 'story'; topicId: string }
  | { name: 'history' }
  | { name: 'profiles' }
  // The server's admin space. section null: the list of its sections (phone), the first one (computer). item: one
  // thing of the section (#/server/plugins/<id>, a plugin's page). plugin: one of a plugin's own sections of the space,
  // and its screens under it.
  | {
      name: 'server'
      section: ServerSection | null
      item?: string
      plugin?: { id: string; section: string; path: string }
    }

// The server's sections, in their order in its sidebar. Each comes with its page.
export const SERVER_SECTIONS = ['overview', 'households', 'accounts', 'content', 'backups', 'mail', 'plugins'] as const
export type ServerSection = (typeof SERVER_SECTIONS)[number]
const serverSectionOf = (slug: string) => SERVER_SECTIONS.find(section => section === slug) ?? null

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
  'plugin',
  'account',
  'shortcuts',
  'about'
] as const
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

// The section names in the address.
const SECTION_SLUGS: Record<SettingsSection, string> = {
  reading: 'reading',
  themes: 'topics',
  sources: 'sources',
  followed: 'followed',
  muted: 'muted',
  notifications: 'notifications',
  me: 'me',
  stats: 'stats',
  ai: 'ai',
  plugin: 'plugin',
  household: 'household',
  profiles: 'profiles',
  sharing: 'sharing',
  account: 'account',
  shortcuts: 'shortcuts',
  about: 'about'
}

const sectionOf = (slug: string) => SETTINGS_SECTIONS.find(section => SECTION_SLUGS[section] === slug) ?? null

// The French addresses of earlier versions, by their first part (then, for Réglages, their section). Bookmarks,
// links shared before the change and push notifications already sent still carry them.
const LEGACY_PATHS = new Map<string, string>(
  Object.entries({
    ecouter: 'videos',
    'plus-tard': 'saved',
    recherche: 'search',
    reglages: 'settings',
    suivis: 'followed',
    partages: 'shares',
    resume: 'summary',
    historique: 'history',
    profils: 'profiles',
    une: 'stories'
  })
)
const LEGACY_SECTIONS = new Map<string, string>(
  Object.entries({
    lecture: 'reading',
    themes: 'topics',
    suivis: 'followed',
    masques: 'muted',
    moi: 'me',
    ia: 'ai',
    foyer: 'household',
    profils: 'profiles',
    partage: 'sharing',
    compte: 'account',
    raccourcis: 'shortcuts',
    'a-propos': 'about',
    demandes: 'requests'
  })
)

// The English address for a French one, or the address itself when it has nothing to translate. Every part but the
// translated names stays as it is, still encoded, so a search with a slash or an accent survives.
export const englishHash = (hash: string) => {
  const parts = hash.replace(/^#\/?/, '').split('/')
  const [first = '', second = ''] = parts
  const path = LEGACY_PATHS.get(first)
  if (path) {
    parts[0] = path
    if (path === 'settings' && second) parts[1] = LEGACY_SECTIONS.get(second) ?? second
    if (path === 'stories' && second) parts[1] = RENAMED_TOPICS.get(second) ?? second
  } else if (RENAMED_TOPICS.has(first)) parts[0] = RENAMED_TOPICS.get(first) ?? first
  else if (first === 'stories' && RENAMED_TOPICS.has(second)) parts[1] = RENAMED_TOPICS.get(second) ?? second
  else return hash
  return `#/${parts.join('/')}`
}

// Addresses whose first part alone names the screen.
const SIMPLE_ROUTES = new Map<string, () => Route>([
  ['sources', () => ({ name: 'settings', section: 'sources' })],
  ['saved', () => ({ name: 'saved' })],
  ['followed', () => ({ name: 'followed' })],
  ['shares', () => ({ name: 'shares' })],
  ['stats', () => ({ name: 'settings', section: 'stats' })],
  ['summary', () => ({ name: 'dailySummary' })],
  ['history', () => ({ name: 'history' })],
  ['profiles', () => ({ name: 'profiles' })]
])

const settingsRoute = (second: string, third: string, path: string): Route => {
  // A teen's request, opened from its notification or the pile on top of Réglages.
  if (second === 'requests' && /^\d+$/.test(third)) return { name: 'settings', section: null, request: Number(third) }
  // Réglages › Plugins went: its list is Serveur › Plugins now, and a plugin's page for profiles is its own entry.
  if (second === 'plugins')
    return third ? { name: 'settings', section: 'plugin', item: third } : { name: 'settings', section: null }
  return {
    name: 'settings',
    section: sectionOf(second),
    ...(third ? { item: third } : {}),
    ...(third && path ? { path } : {})
  }
}

const serverRoute = (parts: string[]): Route => {
  const [, second = '', third = ''] = parts
  if (second === 'plugin' && third && parts[3])
    return { name: 'server', section: null, plugin: { id: third, section: parts[3], path: parts.slice(4).join('/') } }
  return { name: 'server', section: serverSectionOf(second), ...(third ? { item: third } : {}) }
}

export const parseRoute = (hash: string): Route => {
  const parts = englishHash(hash).replace(/^#\/?/, '').split('/').map(decodeURIComponent)
  const [first = '', second = '', third = ''] = parts

  if (!first) return { name: 'frontPage' }
  if (first === 'article' && second) return { name: 'article', articleId: second }
  if (first === 'videos') return { name: 'listen', itemId: second || null }
  if (first === 'search') return { name: 'search', query: second }
  if (first === 'settings') return settingsRoute(second, third, parts.slice(3).join('/'))
  if (first === 'server') return serverRoute(parts)
  const simple = SIMPLE_ROUTES.get(first)
  if (simple) return simple()
  if (first === 'stories' && second) return { name: 'story', topicId: second }

  return { name: 'topic', topicId: first }
}

export const topicHref = (topicId: string) => `#/${encodeURIComponent(topicId)}`
export const articleHref = (articleId: string) => `#/article/${encodeURIComponent(articleId)}`
export const FRONT_PAGE_HREF = '#/'
export const LISTEN_HREF = '#/videos'
export const watchHref = (itemId: string) => `#/videos/${encodeURIComponent(itemId)}`
export const SAVED_HREF = '#/saved'
export const searchHref = (query = '') => `#/search/${encodeURIComponent(query)}`
export const SETTINGS_HREF = '#/settings'
export const settingsHref = (section: SettingsSection) => `#/settings/${SECTION_SLUGS[section]}`
export const requestHref = (id: number) => `#/settings/requests/${id}`
// A young profile's page, for its parents.
export const youngProfileHref = (id: number) => `${settingsHref('profiles')}/${id}`
// A plugin's own page, the entry its manifest places in Réglages, or one of its screens under it (path 'week/3').
export const pluginPageHref = (id: string, path = '') =>
  `${settingsHref('plugin')}/${encodeURIComponent(id)}${path ? `/${path.split('/').map(encodeURIComponent).join('/')}` : ''}`
export const SERVER_HREF = '#/server'
export const serverHref = (section: ServerSection) => `${SERVER_HREF}/${section}`
// A plugin's page in Serveur › Plugins, where its admin turns it on and off, sets it and removes it.
export const serverPluginHref = (id: string) => `${serverHref('plugins')}/${encodeURIComponent(id)}`
// One of a plugin's own sections of the server's space, or one of its screens under it (path 'week/3').
export const serverPluginPageHref = (id: string, section: string, path = '') =>
  `${SERVER_HREF}/plugin/${encodeURIComponent(id)}/${encodeURIComponent(section)}${path ? `/${path.split('/').map(encodeURIComponent).join('/')}` : ''}`
export const FOLLOWED_HREF = '#/followed'
export const SHARES_HREF = '#/shares'
export const DAILY_SUMMARY_HREF = '#/summary'
export const HISTORY_HREF = '#/history'
// On a computer the article open stays beside the next list: this event closes it.
export const CLOSE_READER = 'hodi:close-reader'
export const PROFILES_HREF = '#/profiles'
export const storyHref = (topicId: string) => `#/stories/${encodeURIComponent(topicId)}`

// An old French address is replaced by its English one in place, so the back button never returns to it.
const readRoute = () => {
  const english = englishHash(window.location.hash)
  if (english !== window.location.hash) window.history.replaceState(window.history.state, '', english)
  return parseRoute(english)
}

export const useHashRoute = () => {
  const [route, setRoute] = useState(() => readRoute())

  useEffect(() => {
    const handleChange = () => setRoute(readRoute())

    window.addEventListener('hashchange', handleChange)
    return () => window.removeEventListener('hashchange', handleChange)
  }, [])

  return route
}
