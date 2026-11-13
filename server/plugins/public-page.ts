// The addresses a plugin opens to search engines, in plugin.json (plugin-sdk/README.md, « Public pages »): each with
// its language, and what a search result and a shared link show. The page itself is the plugin's signed-out page,
// drawn by the browser as always; Hodi only writes these few tags in the <head> it sends.
export interface PublicMeta {
  title?: string
  description?: string
  // One of the plugin's assets/ files, 1200 × 630, for the card of a shared link.
  image?: string
}
export interface PublicRoute extends PublicMeta {
  path: string
  lang: string
}
// What a route without its own title, description or image shows; locales/<lang>.json translates the texts
// (publicPages.title and publicPages.description).
export interface PublicPages {
  defaults: PublicMeta
  routes: PublicRoute[]
}

const PATH = /^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*)?$/
const LANG = /^[a-z]{2}$/
const ASSET = /^assets\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*\.(?:png|jpe?g|webp)$/
export const MAX_ROUTES = 20
export const PUBLIC_LIMITS = { title: 70, description: 200 } as const

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

// A text within its limit, or nothing; null when it is there but wrong.
export const publicText = (value: unknown, max: number) => {
  if (value === undefined) return undefined
  return typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null
}

const metaOf = (value: Record<string, unknown>, where: string): PublicMeta => {
  const meta: PublicMeta = {}
  for (const field of ['title', 'description'] as const) {
    const text = publicText(value[field], PUBLIC_LIMITS[field])
    if (text === null) throw new Error(`${where}.${field} must be a text of 1 to ${PUBLIC_LIMITS[field]} characters`)
    if (text) meta[field] = text
  }
  if (value.image !== undefined) {
    if (typeof value.image !== 'string' || !ASSET.test(value.image))
      throw new Error(`${where}.image must be a .png, .jpg or .webp file of assets/`)
    meta.image = value.image
  }
  return meta
}

// publicPages as plugin.json gives it, checked. Throws a plain Error with what is wrong.
export const parsePublicPages = (value: unknown): PublicPages | null => {
  if (value === undefined) return null
  if (!isRecord(value) || !Array.isArray(value.routes) || value.routes.length > MAX_ROUTES)
    throw new Error(`publicPages must be { defaults, routes } with at most ${MAX_ROUTES} routes`)
  const defaults = value.defaults === undefined ? {} : isRecord(value.defaults) ? value.defaults : null
  if (!defaults) throw new Error('publicPages.defaults must be an object')
  const paths = new Set<string>()
  const routes = value.routes.map((route: unknown, index): PublicRoute => {
    const where = `publicPages.routes[${index}]`
    if (!isRecord(route)) throw new Error(`${where} must be an object`)
    if (typeof route.path !== 'string' || !PATH.test(route.path) || paths.has(route.path))
      throw new Error(`${where}.path must be a new address like /, /legal or /en`)
    if (typeof route.lang !== 'string' || !LANG.test(route.lang))
      throw new Error(`${where}.lang must be two letters, like fr`)
    paths.add(route.path)
    return { path: route.path, lang: route.lang, ...metaOf(route, where) }
  })
  return { defaults: metaOf(defaults, 'publicPages.defaults'), routes }
}
