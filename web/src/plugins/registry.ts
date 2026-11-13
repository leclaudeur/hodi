import { type ComponentType, useSyncExternalStore } from 'react'
import i18next from 'i18next'
import type { PluginTranslations } from './plugin-texts.ts'

// The plugins this profile sees, as GET /api/plugins describes them, and what their web.js registered. Loaded once
// signed in, in the background: the app never waits for a plugin to draw its first screen, and without plugins
// nothing more is downloaded.

export interface PluginInfo {
  id: string
  name: string
  version: string | null
  description: string | null
  // Its name and description in other languages (plugin-texts.ts).
  translations: PluginTranslations
  audience: 'admin' | 'all'
  provides: string[]
  menu: { group: string; after?: string; icon?: string } | null
  settings: unknown[]
  values: Record<string, unknown>
  enabled: boolean
  // Whether a trusted key signed it: an unsigned plugin has no web part.
  signed: boolean
  // Installed by « npx hodi-plugin dev » while Mode développeur is on: its web part runs although it is unsigned.
  dev?: boolean
  // publicScript and publicStyle: web-public.js and web-public.css, what it draws before a profile is open, loaded
  // before web.js.
  web: { script: boolean; style: boolean; publicScript: boolean; publicStyle: boolean; locales: string[] }
  // It may send notifications (permissions.notify).
  notifies?: boolean
  // Its AiButton may ask the household's AI (permissions.ai, signed).
  usesAi?: boolean
  error: string | null
  // Loaded before a profile is open, from the plugins that draw on Connexion and « Qui lit ? »: its files come from
  // /api/public/plugins.
  public?: boolean
}

// The article open in the reader, as a plugin's reader action gets it.
export interface ReaderArticle {
  id: string
  title: string
  // Its address on its site.
  url: string
  sourceId: string
  sourceName: string
}

// One of a plugin's own sections of the server's space (#/server): an entry of its group in the server's sidebar,
// under Hodi's groups, and its page.
export interface ServerSection {
  // Its address, #/server/plugin/<plugin id>/<id>: lowercase letters, digits and dashes.
  id: string
  // Its name, a key of the plugin's locales: in the sidebar and as the page's title on a phone.
  label: string
  // The line under its name on a phone, as Hodi's own sections say what they hold ("12 personnes").
  hint?: ComponentType
  // Its icon, drawn at 14 and 18 px (a Lucide icon the plugin bundles); a puzzle piece without one.
  icon?: ComponentType<{ size?: number }>
  // Its page: SectionPage, as Hodi's own sections of the space.
  page: ComponentType<{ layout: 'desktop' | 'phone' }>
}

export const SERVER_SECTION_ID = /^[a-z][a-z0-9-]{0,31}$/

// One of a plugin's cards on Serveur › Vue d'ensemble, after Hodi's « En ligne » and « Profils », before what is read.
// narrow: a third of a computer's width, wide: two thirds, full: all of it (half, half and all of it on a tablet, all of
// it on a phone). Its component gets the period shown, two days (YYYY-MM-DD, both included), and draws an
// OverviewCard of hodi:sdk.
export interface OverviewCardSlot {
  // Lowercase letters, digits and dashes, once per plugin.
  id: string
  size: 'narrow' | 'wide' | 'full'
  component: ComponentType<{ from: string; to: string }>
}

// What a plugin's setup step page gets: next() once it has saved what it needs, and the page's layout.
export interface SetupStepProps {
  next: () => void
  layout: 'desktop' | 'phone'
}

// A step a plugin adds to the setup, after « Plugins trouvés » and before « Le serveur est prêt ». Hodi draws the card,
// the title, the line under it, the numbering and « Retour »; the plugin draws what is in between, ending with its
// SetupActions. Or one of Hodi's own steps, which the plugin only places: `core: 'mail'` is Serveur › E-mail's form.
export type SetupStep =
  | {
      // Lowercase letters, digits and dashes: where the setup comes back to after a reload.
      id: string
      // Keys of the plugin's locales.
      title: string
      intro: string
      page: ComponentType<SetupStepProps>
    }
  | { id: string; core: 'mail' }

// What the page a plugin draws in place of Connexion gets, on a device on no household.
export interface SignedOutPageProps {
  layout: 'desktop' | 'phone'
  // Opens Hodi's Connexion (#/sign-in); the browser's back button comes back to the plugin's page.
  showSignIn: () => void
  // Once one of the plugin's public routes has answered with signIn: the app starts again, signed in.
  signedIn: () => void
}

// What a plugin's step just after sign-in gets: done() lets the person in.
export interface AfterSignInProps {
  layout: 'desktop' | 'phone'
  done: () => void
}

// A line « J'ai au moins 13 ans » goes on with, on « Rejoins le foyer »: a key of the plugin's locales, whose <name>…</name>
// tags become links to links[name], opened in a new tab (an address of this server, or https).
export type AgeConsent = string | { text: string; links: Record<string, string> }

// An entry of the avatar's menu: in the sidebar's profile menu on a computer, at the foot of the profile's sheet on a
// phone or a tablet.
export interface AvatarMenuItem {
  id: string
  // A key of the plugin's locales.
  label: string
  // 16 px, in a round (a Lucide icon the plugin bundles).
  icon?: ComponentType<{ size?: number }>
  onClick: () => void
}

// What a plugin's web.js gives Hodi, through definePlugin() in hodi:sdk.
export interface WebPlugin {
  // Its steps in the setup, in order. Only a plugin turned on at « Plugins trouvés » gets them.
  setupSteps?: SetupStep[]
  // Drawn at the end of an article, beside "Lire l'original": a ReaderButton of hodi:sdk, usually.
  readerAction?: ComponentType<{ article: ReaderArticle }>
  // Drawn under its options in Serveur › Plugins, for the server's admin.
  settingsPage?: ComponentType
  // Its own page, an entry of Réglages where the manifest's menu places it (group, after which entry).
  page?: ComponentType<{ layout: 'desktop' | 'phone' }>
  // That entry's icon, 18 px (a Lucide icon the plugin bundles); a puzzle piece without one.
  menuIcon?: ComponentType<{ size?: number }>
  // The line under that entry's name, as Hodi's own entries say what they hold ("12 articles signalés"); the
  // plugin's description without one.
  menuHint?: ComponentType
  // Its own sections of the server's space, for the server's admin: a group of the server's sidebar named after the
  // plugin. A section whose id is not valid, or comes twice, is left out.
  serverSections?: ServerSection[]
  // Its cards on Serveur › Vue d'ensemble, in order. A card whose id is not valid or comes twice, or whose size is not
  // known, is left out; a card that fails says so in its place.
  overviewCards?: OverviewCardSlot[]
  // The screens around sign-in. Before a profile is open (Connexion, « J'ai un code », « Qui lit ? »), only a plugin whose
  // manifest may open pages without sign-in (permissions.publicRoutes) is loaded, so only such a plugin fills them there.
  // On a device on no household, in place of Connexion: one plugin's page (the first one that has one).
  signedOutPage?: ComponentType<SignedOutPageProps>
  // Under Connexion's form, after Hodi's links: one more way in (« Créer mon foyer », another sign-in).
  signInExtras?: ComponentType<{ layout: 'desktop' | 'phone'; signedIn: () => void }>
  // A step once signed in, before the app (« Quel foyer ? »): one plugin's (the first one that has one).
  afterSignIn?: ComponentType<AfterSignInProps>
  // Beside « Gérer les profils » under « Qui lit ? »'s tiles: buttons at the same height (« Changer de foyer »).
  whoIsReadingFooter?: ComponentType<{ layout: 'desktop' | 'phone' }>
  // After « J'ai au moins 13 ans » (« et j'accepte les conditions d'utilisation »).
  ageConsent?: AgeConsent
  // Rows at the end of « Ton compte » in Réglages › Compte et données: SettingRows.
  accountRows?: ComponentType<{ layout: 'desktop' | 'phone' }>
  // Entries of the avatar's menu.
  avatarMenu?: AvatarMenuItem[]
}

// The plugins that fill a slot, in the order of the plugins, each with what it gave: never a broken one, never one
// that is off.
export const slotsOf = <Key extends keyof WebPlugin>(
  { plugins, web }: Pick<State, 'plugins' | 'web'>,
  key: Key
): { id: string; value: NonNullable<WebPlugin[Key]> }[] =>
  plugins
    .filter(plugin => plugin.enabled && !plugin.error)
    .flatMap(plugin => {
      const value = web.get(plugin.id)?.[key]
      return value === undefined || value === null
        ? []
        : [{ id: plugin.id, value: value as NonNullable<WebPlugin[Key]> }]
    })

export const usePluginSlots = <Key extends keyof WebPlugin>(key: Key) => slotsOf(usePlugins(), key)

interface State {
  ready: boolean
  plugins: PluginInfo[]
  web: ReadonlyMap<string, WebPlugin>
}

let state: State = { ready: false, plugins: [], web: new Map() }
const listeners = new Set<() => void>()

const set = (change: Partial<State>) => {
  state = { ...state, ...change }
  listeners.forEach(listener => listener())
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const usePlugins = () => useSyncExternalStore(subscribe, () => state)

// Whether an active plugin brings this capability: the app asks this, never a plugin's name.
export const hasCapability = (plugins: readonly PluginInfo[], capability: string) =>
  plugins.some(plugin => plugin.enabled && !plugin.error && plugin.provides.includes(capability))

export const usePluginCapability = (capability: string) => hasCapability(usePlugins().plugins, capability)

// A plugin's file. The version in the address makes an updated plugin's files new to the browser at once.
export const pluginFile = (plugin: Pick<PluginInfo, 'id' | 'version' | 'public'>, file: string) =>
  `/api/${plugin.public ? 'public/' : ''}plugins/${encodeURIComponent(plugin.id)}/files/${file}?v=${encodeURIComponent(plugin.version ?? '')}`

export const pluginNamespace = (id: string) => `plugin.${id}`

// The languages to load for a plugin: the one shown, and French, the fallback, when the plugin has them.
export const localesToLoad = (available: readonly string[], language: string) =>
  [...new Set([language, 'fr'])].filter(candidate => available.includes(candidate))

// The script running now registers under the plugin it was loaded for (see load below).
const PLUGIN_ATTRIBUTE = 'data-hodi-plugin'

// web-public.js and web.js each call definePlugin(): what web.js gives comes on top of what web-public.js gave.
export const registerWebPlugin = (definition: WebPlugin) => {
  const id = document.currentScript?.getAttribute(PLUGIN_ATTRIBUTE)
  if (!id) throw new Error('definePlugin() must run in a plugin’s web.js, as it loads')
  set({ web: new Map(state.web).set(id, { ...state.web.get(id), ...definition }) })
}

const loadLocales = async (plugin: PluginInfo, language: string) => {
  const namespace = pluginNamespace(plugin.id)
  await Promise.all(
    localesToLoad(plugin.web.locales, language)
      .filter(locale => !i18next.hasResourceBundle(locale, namespace))
      .map(async locale => {
        const response = await fetch(pluginFile(plugin, `locales/${locale}.json`))
        if (!response.ok) throw new Error(`locales/${locale}.json answered ${response.status}`)
        i18next.addResourceBundle(locale, namespace, (await response.json()) as object)
      })
  )
}

const addElement = (element: HTMLLinkElement | HTMLScriptElement) =>
  new Promise<void>((resolve, reject) => {
    element.addEventListener('load', () => resolve())
    element.addEventListener('error', () => reject(new Error(`${element.tagName.toLowerCase()} did not load`)))
    document.head.append(element)
  })

const addStyle = (plugin: PluginInfo, file: string) => {
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = pluginFile(plugin, file)
  return addElement(link)
}

const addScript = (plugin: PluginInfo, file: string) => {
  const script = document.createElement('script')
  script.src = pluginFile(plugin, file)
  script.async = false
  script.setAttribute(PLUGIN_ATTRIBUTE, plugin.id)
  return addElement(script)
}

// The public part first, then the rest: before a profile is open, only the public part is listed.
const loadOne = async (plugin: PluginInfo) => {
  await loadLocales(plugin, i18next.language)
  if (plugin.web.publicStyle) await addStyle(plugin, 'web-public.css')
  if (plugin.web.style) await addStyle(plugin, 'web.css')
  if (plugin.web.publicScript) await addScript(plugin, 'web-public.js')
  if (plugin.web.script) await addScript(plugin, 'web.js')
}

// A plugin's files that do not come within this time are given up: the screen after sign-in waits for the plugins.
const PLUGIN_LOAD_MS = 5000
const withinTime = (loading: Promise<void>) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no answer in ${PLUGIN_LOAD_MS} ms`)), PLUGIN_LOAD_MS)
    loading.then(resolve, reject).finally(() => clearTimeout(timer))
  })

// Which list this page loaded: one per page, since signing in or out starts the app again.
let started: 'signedIn' | 'public' | null = null
export const loadedPlugins = () => started

// What /api/public/plugins says of a plugin: enough to load it, nothing of its settings.
interface PublicPlugin {
  id: string
  name: string
  version: string | null
  web: PluginInfo['web']
}

const publicInfo = (plugin: PublicPlugin): PluginInfo => ({
  ...plugin,
  description: null,
  translations: {},
  audience: 'all',
  provides: [],
  menu: null,
  settings: [],
  values: {},
  enabled: true,
  signed: true,
  error: null,
  public: true
})

// Signed in: the plugins this profile sees.
export const loadPlugins = () => load('signedIn')

// Before a profile is open: the plugins that draw on Connexion and « Qui lit ? ».
export const loadPublicPlugins = () => load('public')

const load = async (kind: 'signedIn' | 'public') => {
  if (started) return
  started = kind
  try {
    const response = await fetch(kind === 'public' ? '/api/public/plugins' : '/api/plugins')
    if (!response.ok) return
    const answer = (await response.json()) as { plugins: PluginInfo[] | PublicPlugin[] }
    const plugins =
      kind === 'public' ? (answer.plugins as PublicPlugin[]).map(publicInfo) : (answer.plugins as PluginInfo[])
    const active = plugins.filter(plugin => plugin.enabled && !plugin.error)
    // React, the SDK and Hodi's components, given to the plugins' scripts: only once a plugin has one.
    if (active.some(plugin => plugin.web.script || plugin.web.publicScript)) await import('./host.ts')
    // One plugin that fails to load, or takes too long, never stops the others nor the app.
    await Promise.all(
      active.map(plugin =>
        withinTime(loadOne(plugin)).catch((error: unknown) => console.error(`Plugin ${plugin.id} not loaded:`, error))
      )
    )
    set({ plugins })
    // A language shown later brings the plugins' texts in it.
    i18next.on('languageChanged', language => {
      for (const plugin of active) void loadLocales(plugin, language).catch(() => {})
    })
  } catch (error) {
    console.error('Plugins not loaded:', error)
  } finally {
    set({ ready: true })
  }
}
