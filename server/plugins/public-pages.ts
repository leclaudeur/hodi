import type { LoadedPlugin } from './registry.ts'

// A public page as Hodi serves it: a route of a plugin's publicPages, with every text and its image found. Each falls
// back from the route, to the plugin's defaults in the route's language, to Hodi's own (Hodi's locales, its banner).
export interface PublicPage {
  plugin: string
  path: string
  lang: string
  title: string
  description: string
  // The card's picture, as an address of this server.
  image: string
}

// Hodi's own card, when a plugin gives none: by language, French when Hodi has none for it.
export type HodiCard = (lang: string) => { title: string; description: string; image: string }

const onScreens = (plugin: LoadedPlugin, enabled: (id: string) => boolean) =>
  (plugin.signed || plugin.dev) &&
  enabled(plugin.id) &&
  !plugin.error &&
  Boolean(plugin.web.publicScript) &&
  plugin.manifest?.permissions.publicRoutes === true

const assetUrl = (plugin: string, file: string) => `/api/public/plugins/${encodeURIComponent(plugin)}/files/${file}`

// The routes of the plugins drawing the signed-out screens, at most one per address (the first plugin in order keeps
// it). Read from plugin.json: nothing of the plugin's code runs.
export const publicPagesOf = (loaded: LoadedPlugin[], enabled: (id: string) => boolean, hodi: HodiCard) => {
  const taken = new Set<string>()
  const pages: PublicPage[] = []
  for (const plugin of loaded) {
    const declared = plugin.manifest?.publicPages
    if (!declared || !onScreens(plugin, enabled)) continue
    const { defaults } = declared
    for (const route of declared.routes) {
      if (taken.has(route.path)) continue
      taken.add(route.path)
      const translated = plugin.translations[route.lang]
      const own = hodi(route.lang)
      const image = route.image ?? defaults.image
      pages.push({
        plugin: plugin.id,
        path: route.path,
        lang: route.lang,
        title: route.title ?? translated?.publicTitle ?? defaults.title ?? own.title,
        description: route.description ?? translated?.publicDescription ?? defaults.description ?? own.description,
        image: image ? assetUrl(plugin.id, image) : own.image
      })
    }
  }
  return pages
}

// The same page in another language: its address with that language in front (/en is /, /en/legal is /legal).
export const sameAs = (page: PublicPage, other: PublicPage) => {
  const bare = (entry: PublicPage) => entry.path.replace(new RegExp(`^/${entry.lang}(?=/|$)`), '') || '/'
  return page.plugin === other.plugin && bare(page) === bare(other)
}
