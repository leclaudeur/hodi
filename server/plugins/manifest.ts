// What a plugin tells Hodi about itself, in the plugin.json at the root of its folder.
import { type PublicPages, parsePublicPages } from './public-page.ts'

// The version of the plugin API this Hodi speaks. A plugin written for another major version is not loaded.
// API 2 runs a plugin's server part in its sandbox (sandbox/): its routes are a table of handlers, no longer an
// Express router. An API 1 plugin is listed, with OUTDATED_API as its error, until it is updated.
export const PLUGIN_API = 2
export const OUTDATED_API = 'outdated_api'

// What a plugin may bring that the rest of Hodi asks about. The list is closed: a new capability comes with the core
// change that uses it.
export const CAPABILITIES = ['profile-kind:child', 'shell:child', 'speech'] as const
export type Capability = (typeof CAPABILITIES)[number]

// Who sees the plugin, its pages and its routes: the household's admin only, or every profile.
export const AUDIENCES = ['admin', 'all'] as const
export type Audience = (typeof AUDIENCES)[number]

// The settings a plugin declares; Hodi draws their rows on the plugin's options page.
export type SettingSpec =
  | { key: string; type: 'boolean'; default: boolean }
  | { key: string; type: 'number'; default: number; min?: number; max?: number }
  | { key: string; type: 'text'; default: string; maxLength?: number }
  | { key: string; type: 'choice'; default: string; options: string[] }

export type SettingValue = boolean | number | string
export type SettingValues = Record<string, SettingValue>

// Where the plugin's own page sits in Réglages, after which entry of which group.
export interface MenuPlacement {
  group: string
  after?: string
  icon?: string
}

// What a plugin may ask of Hodi beyond its own database, settings and log. Hodi checks each request against these in
// the main thread, whatever the plugin's code does.
export interface Permissions {
  // The sites ctx.fetchText may reach, by exact host name: none unless listed. A redirect to another host is refused.
  network: string[]
  // ctx.articles: the articles Hodi listed, and their pages.
  articles: boolean
  // Its publicRoutes, served to anyone (a device on no household, a visitor) under /api/public/plugins/<id>/.
  publicRoutes: boolean
  // ctx.accounts: find, make and check people's accounts.
  accounts: boolean
  // ctx.mail: e-mails through Serveur › E-mail.
  mail: boolean
  // signIn in a public route's answer, for an account the call made or checked; and checkSignIn, which may refuse a
  // sign-in.
  signIn: boolean
  // ctx.households: list, make, suspend and remove households (only its own for the last three).
  households: boolean
  // ctx.notify: a notification on a person's devices.
  notify: boolean
  // ctx.ai: one question to the household's AI per click on the plugin's AiButton. Only a signed plugin ("Vérifié")
  // gets it: the AI is paid for by the household.
  ai: boolean
}

// A feed the plugin offers in Réglages › Sources › « Sources proposées », in a topic of Hodi's. Its articles link to
// its site, one of the hosts of permissions.network, and open with their summary and a link, never in the reader.
export interface PluginFeed {
  key: string
  name: string
  site: string
  lang: 'fr' | 'en'
  topic: string
}

export interface Manifest {
  id: string
  name: string
  version: string
  description: string
  api: number
  audience: Audience
  provides: Capability[]
  menu: MenuPlacement | null
  settings: SettingSpec[]
  permissions: Permissions
  feeds: PluginFeed[]
  // The memory its server part may use, in MiB; Hodi keeps it within its own ceiling (sandbox.ts).
  memoryMb: number | null
  // The addresses it opens to search engines, with permissions.publicRoutes only (public-page.ts).
  publicPages: PublicPages | null
}

// Lowercase letters, digits and dashes: the id names the plugin's folder, its routes and its tables.
const ID = /^[a-z][a-z0-9-]{1,31}$/
// Paths of Serveur › Plugins' own routes, beside the plugins' ones.
const RESERVED_IDS = ['packages', 'dev-mode']
const KEY = /^[a-zA-Z][a-zA-Z0-9]{0,31}$/
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const MAX_SETTINGS = 32
const MAX_TEXT = 2000
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
const MAX_HOSTS = 20
const MAX_FEEDS = 5
// A topic's id in sources.yml (belgium, world, tech…).
const TOPIC = /^[a-z][a-z0-9-]{0,31}$/
// The memory a plugin's code gets unless its manifest asks for more, and the most it may ask: plugins share one
// budget (sandbox/sandbox.ts), so a bigger one is refused at install rather than failing at its first call.
// What only a plugin a trusted key signed may ask: they reach people's accounts, households, sign-ins, mail and
// notifications. An unsigned plugin asking any of them is refused at install and not loaded; « npx hodi-plugin dev »
// keeps them, to test them. (permissions.ai is for signed plugins too, but an unsigned one only goes without it.)
export const SIGNED_ONLY = ['accounts', 'households', 'signIn', 'mail', 'notify'] as const
export type SignedOnly = (typeof SIGNED_ONLY)[number]

// The signed-only permissions this manifest asks for.
export const signedOnlyAsked = (manifest: Manifest): SignedOnly[] =>
  SIGNED_ONLY.filter(permission => manifest.permissions[permission])

export const DEFAULT_MEMORY_MB = 16
export const MAX_MEMORY_MB = 32

export class ManifestError extends Error {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const text = (value: unknown, field: string, max: number) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new ManifestError(`${field} must be a non-empty text of at most ${max} characters`)
  }
  return value.trim()
}

type SettingFields = Record<string, unknown> & { key: string }

const numberSetting = (value: SettingFields, index: number, fallback: number): SettingSpec => {
  const min = typeof value.min === 'number' ? value.min : undefined
  const max = typeof value.max === 'number' ? value.max : undefined
  if ((min !== undefined && fallback < min) || (max !== undefined && fallback > max)) {
    throw new ManifestError(`settings[${index}].default is out of its range`)
  }
  return { key: value.key, type: 'number', default: fallback, min, max }
}

const textSetting = (value: SettingFields, index: number, fallback: string): SettingSpec => {
  const maxLength = typeof value.maxLength === 'number' ? Math.min(value.maxLength, MAX_TEXT) : MAX_TEXT
  if (fallback.length > maxLength) throw new ManifestError(`settings[${index}].default is too long`)
  return { key: value.key, type: 'text', default: fallback, maxLength }
}

const isChoice = (value: SettingFields) =>
  Array.isArray(value.options) &&
  value.options.length > 0 &&
  value.options.every(option => typeof option === 'string' && KEY.test(option)) &&
  value.options.includes(value.default)

const parseSetting = (value: unknown, index: number): SettingSpec => {
  if (!isRecord(value)) throw new ManifestError(`settings[${index}] must be an object`)
  const { key, type } = value
  if (typeof key !== 'string' || !KEY.test(key)) throw new ManifestError(`settings[${index}].key is not a valid key`)
  const fields = { ...value, key }

  if (type === 'boolean' && typeof value.default === 'boolean') return { key, type, default: value.default }
  if (type === 'number' && typeof value.default === 'number' && Number.isFinite(value.default)) {
    return numberSetting(fields, index, value.default)
  }
  if (type === 'text' && typeof value.default === 'string') return textSetting(fields, index, value.default)
  if (type === 'choice' && isChoice(fields)) {
    return { key, type, default: value.default as string, options: value.options as string[] }
  }

  throw new ManifestError(`settings[${index}] has an unknown type or a default that does not fit it`)
}

const parseIdentity = (value: Record<string, unknown>) => {
  const { id, version, api } = value
  if (typeof id !== 'string' || !ID.test(id)) throw new ManifestError('id must be lowercase letters, digits and dashes')
  if (RESERVED_IDS.includes(id)) throw new ManifestError(`${id} is a name Hodi keeps for itself`)
  if (typeof version !== 'string' || !VERSION.test(version)) throw new ManifestError('version must be like 1.2.3')
  if (api === 1) throw new ManifestError(OUTDATED_API)
  if (api !== PLUGIN_API) throw new ManifestError(`api must be ${PLUGIN_API}, this plugin was written for ${api}`)
  return { id, version, api }
}

const parseMenu = (menu: unknown): MenuPlacement | null => {
  if (menu === undefined) return null
  if (!isRecord(menu) || typeof menu.group !== 'string' || !KEY.test(menu.group)) {
    throw new ManifestError('menu.group must name a group of Réglages')
  }
  const { after, icon } = menu
  if (after !== undefined && (typeof after !== 'string' || !KEY.test(after))) {
    throw new ManifestError('menu.after must name an entry of Réglages')
  }
  if (icon !== undefined && (typeof icon !== 'string' || !/^[A-Z][A-Za-z0-9]{0,47}$/.test(icon))) {
    throw new ManifestError('menu.icon must be the name of a Lucide icon')
  }
  return { group: menu.group, ...(after ? { after } : {}), ...(icon ? { icon } : {}) }
}

const parseSettings = (settings: unknown) => {
  if (!Array.isArray(settings) || settings.length > MAX_SETTINGS) {
    throw new ManifestError(`settings must be a list of at most ${MAX_SETTINGS}`)
  }
  const specs = settings.map(parseSetting)
  if (new Set(specs.map(spec => spec.key)).size !== specs.length) throw new ManifestError('settings keys must differ')
  return specs
}

// The switches a manifest may turn on, each false unless it says true.
const FLAGS = ['articles', 'publicRoutes', 'accounts', 'mail', 'signIn', 'households', 'notify', 'ai'] as const

const parsePermissions = (value: unknown): Manifest['permissions'] => {
  if (!isRecord(value)) throw new ManifestError('permissions must be an object')
  const network = value.network ?? []
  if (
    !Array.isArray(network) ||
    network.length > MAX_HOSTS ||
    !network.every(host => typeof host === 'string' && HOST.test(host))
  ) {
    throw new ManifestError(`permissions.network must list at most ${MAX_HOSTS} host names, in lower case`)
  }
  const flags = FLAGS.map(name => {
    const flag = value[name] ?? false
    if (typeof flag !== 'boolean') throw new ManifestError(`permissions.${name} must be true or false`)
    return [name, flag] as const
  })
  return {
    network: [...new Set(network as string[])],
    ...(Object.fromEntries(flags) as Record<(typeof FLAGS)[number], boolean>)
  }
}

const parseFeed = (feed: unknown, index: number, network: string[]): PluginFeed => {
  const where = `feeds[${index}]`
  if (!isRecord(feed)) throw new ManifestError(`${where} must be an object`)
  if (typeof feed.key !== 'string' || !KEY.test(feed.key)) throw new ManifestError(`${where}.key must be a short key`)
  // Its articles link to its site: a host the plugin already declares it reaches, so the admin saw it.
  if (typeof feed.site !== 'string' || !network.includes(feed.site)) {
    throw new ManifestError(`${where}.site must be one of permissions.network`)
  }
  if (feed.lang !== 'fr' && feed.lang !== 'en') throw new ManifestError(`${where}.lang must be fr or en`)
  if (typeof feed.topic !== 'string' || !TOPIC.test(feed.topic)) {
    throw new ManifestError(`${where}.topic must be the id of a topic`)
  }
  return {
    key: feed.key,
    name: text(feed.name, `${where}.name`, 60),
    site: feed.site,
    lang: feed.lang,
    topic: feed.topic
  }
}

const parseFeeds = (feeds: unknown, network: string[]) => {
  if (!Array.isArray(feeds) || feeds.length > MAX_FEEDS) {
    throw new ManifestError(`feeds must be a list of at most ${MAX_FEEDS}`)
  }
  const parsed = feeds.map((feed: unknown, index) => parseFeed(feed, index, network))
  if (new Set(parsed.map(feed => feed.key)).size !== parsed.length) throw new ManifestError('feeds keys must differ')
  return parsed
}

const parseMemory = (memoryMb: unknown) => {
  if (
    memoryMb !== null &&
    (typeof memoryMb !== 'number' || !Number.isInteger(memoryMb) || memoryMb < 1 || memoryMb > MAX_MEMORY_MB)
  ) {
    throw new ManifestError(`memoryMb must be a whole number of MiB, at most ${MAX_MEMORY_MB}`)
  }
  return memoryMb
}

// Reads a plugin.json, refusing anything Hodi could not use safely.
export const parseManifest = (value: unknown): Manifest => {
  if (!isRecord(value)) throw new ManifestError('plugin.json must hold an object')

  const { id, version, api } = parseIdentity(value)

  const audience = value.audience ?? 'all'
  if (!AUDIENCES.includes(audience as Audience)) throw new ManifestError('audience must be admin or all')

  const provides = value.provides ?? []
  if (!Array.isArray(provides) || !provides.every(entry => CAPABILITIES.includes(entry as Capability))) {
    throw new ManifestError(`provides may only hold ${CAPABILITIES.join(', ')}`)
  }

  const menu = parseMenu(value.menu)
  const settings = parseSettings(value.settings ?? [])
  const permissions = parsePermissions(value.permissions ?? {})
  const feeds = parseFeeds(value.feeds ?? [], permissions.network)
  const memoryMb = parseMemory(value.memoryMb ?? null)
  const publicPages = parsePublic(value.publicPages, permissions)

  return {
    id,
    name: text(value.name, 'name', 60),
    version,
    description: text(value.description, 'description', 280),
    api,
    audience: audience as Audience,
    provides: [...new Set(provides as Capability[])],
    menu,
    settings,
    permissions,
    feeds,
    memoryMb,
    publicPages
  }
}

const parsePublic = (value: unknown, permissions: Permissions) => {
  try {
    const pages = parsePublicPages(value)
    if (pages && !permissions.publicRoutes) throw new Error('publicPages needs permissions.publicRoutes')
    return pages
  } catch (error) {
    throw new ManifestError((error as Error).message)
  }
}

// The stored values a plugin's settings hold now: the defaults, overridden by what the admin chose and still fits.
export const settingValues = (specs: SettingSpec[], stored: Record<string, unknown>): SettingValues =>
  Object.fromEntries(
    specs.map(spec => {
      const value = stored[spec.key]
      return [spec.key, fits(spec, value) ? value : spec.default]
    })
  )

const fits = (spec: SettingSpec, value: unknown): value is SettingValue => {
  switch (spec.type) {
    case 'boolean':
      return typeof value === 'boolean'
    case 'number':
      return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        (spec.min === undefined || value >= spec.min) &&
        (spec.max === undefined || value <= spec.max)
      )
    case 'text':
      return typeof value === 'string' && value.length <= (spec.maxLength ?? MAX_TEXT)
    case 'choice':
      return typeof value === 'string' && spec.options.includes(value)
  }
}

// Checks what the admin sends: only declared keys, each fitting its type. Returns null when anything is wrong.
export const checkSettings = (specs: SettingSpec[], input: unknown): SettingValues | null => {
  if (!isRecord(input)) return null
  const checked: SettingValues = {}
  for (const [key, value] of Object.entries(input)) {
    const spec = specs.find(candidate => candidate.key === key)
    if (!spec || !fits(spec, value)) return null
    checked[key] = value
  }
  return checked
}
