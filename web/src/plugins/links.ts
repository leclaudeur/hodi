import { useMemo } from 'react'
import {
  FRONT_PAGE_HREF,
  SETTINGS_HREF,
  articleHref,
  pluginPageHref,
  serverPluginHref,
  serverPluginPageHref,
  useHashRoute
} from '../lib/use-hash-route.ts'
import { usePluginId } from './scope.ts'

// Hodi's addresses as a plugin links to them. A plugin never writes one itself: these follow Hodi when its routes
// change (an old address stays a redirect in use-hash-route.ts), so a plugin built today keeps working.
export interface PluginLinks {
  frontPage: string
  article: (id: string) => string
  settings: string
  // Its page in Serveur › Plugins, where the server's admin sets it: only the server's admin reaches it.
  plugins: string
  // The plugin's own page, or one of its screens under it: page('week/3').
  page: (path?: string) => string
  // One of its own sections of the server's space, or one of its screens under it: serverPage('waitlist', '12').
  serverPage: (section: string, path?: string) => string
}

export const usePluginLinks = (): PluginLinks => {
  const id = usePluginId()
  return useMemo(
    () => ({
      frontPage: FRONT_PAGE_HREF,
      article: articleHref,
      settings: SETTINGS_HREF,
      plugins: serverPluginHref(id),
      page: (path = '') => pluginPageHref(id, path),
      serverPage: (section: string, path = '') => serverPluginPageHref(id, section, path)
    }),
    [id]
  )
}

// Goes to one of those addresses, as a link would, from a button or after an action.
export const navigate = (href: string) => {
  window.location.hash = href
}

// Which of its screens the plugin's page shows: what follows #/settings/plugin/<id> in the address, or
// #/server/plugin/<id>/<section> in one of its sections of the server's space; '' at its root.
export const usePluginPath = () => {
  const id = usePluginId()
  const route = useHashRoute()
  if (route.name === 'server') return route.plugin?.id === id ? route.plugin.path : ''
  return route.name === 'settings' && route.section === 'plugin' && route.item === id ? (route.path ?? '') : ''
}
