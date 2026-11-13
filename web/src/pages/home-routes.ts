import type { Section } from '../app/nav.ts'
import type { Route } from '../lib/use-hash-route.ts'

// The lists an article can be opened from: Le fil (topicId null), a topic, the saved or followed articles, a search,
// the history.
export type List =
  | { name: 'feed'; topicId: string | null }
  | { name: 'saved' }
  | { name: 'followed' }
  | { name: 'shares' }
  | { name: 'search' }
  | { name: 'history' }

export const FEED: List = { name: 'feed', topicId: null }

export const listOf = (route: Route): List | null => {
  switch (route.name) {
    case 'frontPage':
    case 'story':
    case 'dailySummary':
      return FEED
    case 'topic':
      return { name: 'feed', topicId: route.topicId }
    case 'saved':
    case 'followed':
    case 'shares':
    case 'search':
    case 'history':
      return { name: route.name }
    default:
      return null
  }
}

export const keyOf = (list: List) => (list.name === 'feed' ? `feed:${list.topicId ?? ''}` : list.name)

// The navigation entry lit for a route: a section, or a topic's id.
export const activeOf = (route: Route, list: List | null): Section | 'search' | string | null => {
  if (route.name === 'search') return 'search'
  if (route.name === 'settings') return 'settings'
  if (route.name === 'listen') return 'watch'
  if (!list) return null
  if (list.name === 'feed') return list.topicId ?? 'today'
  return list.name
}

// The phone's tab lit: Le fil for every topic, and on a phone the history opens from the settings.
export const phoneActiveOf = (route: Route, list: List | null) => {
  if (list?.name === 'feed') return 'today'
  if (list?.name === 'history') return 'settings'
  return activeOf(route, list) as Section | 'search' | null
}

// On a computer, the article open stays beside whichever list is chosen next, until another one, a video, a
// story or the settings take its place.
export const keptOf = (route: Route, routeList: List | null, keptArticle: string | null) => {
  if (route.name === 'article') return route.articleId
  if (routeList && route.name !== 'story' && route.name !== 'dailySummary') return keptArticle
  return null
}

// What the panel shows on a computer or a tablet, by which a new one eases in.
const panelKeyOf = (route: Route, readerId: string | null) => {
  if (readerId) return readerId
  if (route.name === 'listen') return `listen-${route.itemId}`
  if (route.name === 'settings') return `settings-${route.section}-${route.item ?? ''}`
  if (route.name === 'story') return `story-${route.topicId}`
  if (route.name === 'dailySummary' || route.name === 'profiles') return route.name
  return 'empty'
}

// The phone's screen under the navigation, the same while a story or the search's results change over it.
export const screenKeyOf = (route: Route, readerId: string | null, inPanel: boolean) => {
  if (inPanel) return panelKeyOf(route, readerId)
  if (route.name === 'search') return 'search'
  if (route.name === 'story' || route.name === 'dailySummary') return '{"name":"frontPage"}'
  return JSON.stringify(route)
}

// What eases in as the page changes: the panel's content (inside its scrollbars once they are set up), or the phone's screen.
export const panelContent = (main: HTMLElement) =>
  main.querySelector('[data-overlayscrollbars-contents]') ?? main.firstElementChild?.firstElementChild ?? null
export const screenContent = (main: HTMLElement) => main.firstElementChild
