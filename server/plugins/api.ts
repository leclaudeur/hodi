import type { PublicServerSettings } from '../db/server-settings-store.ts'
import type { PluginArticle } from './articles.ts'
import type { SettingValues } from './manifest.ts'

// The plugin API 2, as a plugin's server.js sees it: what its handlers receive and answer. Types only, for the SDK
// (plugin-sdk/server.ts): the plugin's code runs in its sandbox (sandbox/), where Hodi builds these objects.

// A BLOB is a Uint8Array, both ways.
export type SqlValue = string | number | boolean | null | Uint8Array

export interface PluginDatabase {
  // The rows a SELECT gives, each an object by column name.
  query: (sql: string, params?: SqlValue[]) => Record<string, SqlValue>[]
  // The first row, or null.
  get: (sql: string, params?: SqlValue[]) => Record<string, SqlValue> | null
  // An INSERT, UPDATE, DELETE or schema change.
  run: (sql: string, params?: SqlValue[]) => { changes: number; lastInsertRowid: number }
}

export interface PluginContext {
  id: string
  // Its own SQLite file: its own tables, named as it likes.
  db: PluginDatabase
  // Its settings as they are now, defaults included.
  settings: () => SettingValues
  log: (message: string) => void
  // A page of a site its manifest lists in permissions.network.
  // Only Accept, Accept-Language, If-None-Match and If-Modified-Since among headers; Hodi writes the others.
  fetchText: (url: string, options?: { headers?: Record<string, string> }) => Promise<{ url: string; text: string }>
  // Any request to a site its manifest lists in permissions.network, such as an OAuth token exchange: its answer comes
  // back whatever its status, as text (512 KB at most). One body at most, 64 KB: text, json (sent as JSON) or form (sent
  // as a form). A body or an Authorization header only goes over https. Headers: Accept, Accept-Language,
  // Content-Type, Authorization, If-None-Match and If-Modified-Since; Hodi writes the others. A request with a body
  // never follows a redirect: the redirect is the answer.
  http: (
    url: string,
    options?: {
      method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
      headers?: Record<string, string>
      body?: string
      json?: unknown
      form?: Record<string, string>
    }
  ) => Promise<{ url: string; status: number; contentType: string | null; text: string }>
  // With permissions.articles: an article Hodi listed (null for an id it never listed), and its page as the site serves
  // it now. Only while the call runs, in the household it runs for: work left running after it returns is refused.
  articles: {
    get: (id: string) => Promise<PluginArticle | null>
    page: (id: string) => Promise<{ url: string; html: string } | null>
  }
  // Serveur › Contenu and Sauvegardes, read only, for every plugin: how many days an article, a video and a read text
  // are kept, and how many nightly copies of the database. Legal pages say these numbers rather than writing them.
  serverSettings: () => Promise<PublicServerSettings>
  // With permissions.mail: an e-mail through Serveur › E-mail. available() is false until the admin set it up, and
  // send() then refuses. One plain address, a one-line subject and plain text: Hodi adds its footer naming the plugin,
  // and refuses past 50 e-mails an hour ('mail_limit'). appUrl() is the server's address set there, for a link in an
  // e-mail (such as a waiting list's confirmation), or null.
  mail: {
    available: () => Promise<boolean>
    appUrl: () => Promise<string | null>
    send: (message: { to: string; subject: string; text: string }) => Promise<void>
  }
  // With permissions.households: the server's households. create() sets one up with its admin: an existing account
  // (never the server's admin) that joins at once, or a first name whose profile waits for the code it answers (24 h,
  // once, through « J'ai un code »). suspend(), resume() and remove() only take a household this plugin made, else
  // refuse with 'not_allowed'; remove() deletes it and all it holds, its people's accounts stay.
  households: {
    list: () => Promise<PluginHousehold[]>
    get: (id: number) => Promise<PluginHousehold | null>
    of: (accountId: number) => Promise<PluginHousehold[]>
    create: (household: {
      name: string
      language?: 'fr' | 'en'
      admin: { name: string; accountId?: number } | null
    }) => Promise<PluginHousehold & { code: { code: string; expiresAt: number } | null }>
    suspend: (id: number) => Promise<void>
    resume: (id: number) => Promise<void>
    remove: (id: number) => Promise<void>
  }
  // With permissions.notify: a notification on a person's devices, through the same push as shares, in each device's
  // quiet hours and only where its « Plugins » switch is on. profileId, or accountId for every profile of an account;
  // within a route's call, only the people of its household. title (80 characters) and text (240), plain text; path:
  // where it opens under the plugin's page (#/settings/plugin/<id>/<path>). Ten a day per profile at most:
  // 'too_many_notices' past them.
  notify?: (notice: {
    profileId?: number
    accountId?: number
    title: string
    text: string
    path?: string
  }) => Promise<void>
  // With permissions.ai, for a signed plugin ("Vérifié"): one question to the household's AI, only inside an aiActions
  // handler, which only a click on the plugin's AiButton (hodi:sdk) runs, and once per click: anywhere else it refuses
  // with 'ai_no_click', a second time with 'ai_already_asked'. Plain text: prompt (8000 characters), system (2000),
  // maxTokens (1 to 1024, 512 by default); the answer's text comes back, 8000 characters at most. It counts against
  // the household's daily plugin cap and 10 an hour per plugin. It refuses a question that does not fit with
  // 'ai_invalid_question', and one Hodi cannot ask with 'ai_unavailable', 'ai_off',
  // 'ai_limited', 'ai_refused' or 'ai_failed'. The plugin never sees the key, the provider or the model.
  ai?: {
    ask: (question: { prompt: string; system?: string; maxTokens?: number }) => Promise<string>
  }
  // With permissions.accounts: people's accounts, never with anything that could sign them in. create() makes an
  // account (null when the address has one already): with a password, a login of the plugin's (its own name for the
  // person, such as google:<id>, 200 characters at most), or both; with a login alone, the account has no password
  // (loginOnly) and its person comes in through the plugin. checkPassword() answers the account when the password is
  // right, null otherwise; it counts with the failed sign-ins of the address the call came from, and refuses with
  // 'throttled' past their limit. findByLogin() answers the account this plugin's login leads to. addLogin() gives
  // one to an account this same call made, checked or found (never the server's admin): false when the login leads
  // to another account. Each plugin only reads its own logins, and they go when the plugin is removed.
  accounts: {
    get: (id: number) => Promise<PluginAccount | null>
    findByEmail: (email: string) => Promise<PluginAccount | null>
    create: (account: { email: string; password?: string; login?: string }) => Promise<PluginAccount | null>
    checkPassword: (email: string, password: string) => Promise<PluginAccount | null>
    findByLogin: (login: string) => Promise<PluginAccount | null>
    addLogin: (accountId: number, login: string) => Promise<boolean>
  }
}

// What a plugin learns of a household: never what it holds (its profiles' reading, its settings).
export interface PluginHousehold {
  id: number
  name: string
  language: 'fr' | 'en'
  createdAt: number
  // Suspended by the plugin that made it: Hodi only keeps the mark, the plugin's checkSignIn decides what it means.
  suspended: boolean
  // Made by this plugin: the only households it may suspend, resume or remove.
  mine: boolean
  // The address of its photo, set in Réglages › Foyer, for an <img> on a page of its people (only they get it); null:
  // no photo, show its initial (HouseholdAvatar in hodi:sdk does both).
  photo: string | null
}

// What a plugin learns of an account.
export interface PluginAccount {
  id: number
  email: string
  // true for an account made with a login alone: no password of its own until its person sets one.
  loginOnly: boolean
  serverAdmin: boolean
}

// Who asks, as Hodi checked it. No cookie, header or session reaches the plugin.
export interface PluginCaller {
  // The profile open on the device; null in the server's own space for an admin outside the household.
  profileId: number | null
  // The household it asks for; null in the server's own space for an admin outside the household. A plugin serves
  // every household on the server from one database: it keeps their data apart with this.
  householdId: number | null
  kind: 'adult' | 'teen' | 'child'
  // The household's admin.
  householdAdmin: boolean
  // The server's admin.
  serverAdmin: boolean
  // The account signed in on the device, which may differ from the open profile's own on a shared device (its
  // households: ctx.households.of(accountId)); null without one.
  accountId: number | null
}

export interface PluginRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  // The path under the plugin's own, such as /notes/12.
  path: string
  // The named parts of the route's path: 'GET /notes/:id' gives { id: '12' }.
  params: Record<string, string>
  query: Record<string, string>
  // The JSON the request carried, or null; for a raw route, its bytes.
  body: unknown
  who: PluginCaller
}

// A file of a zip Hodi builds: text the plugin gives, or the first column of one row its SELECT finds in its own
// database (the bytes never pass through the plugin).
export type PluginZipEntry =
  { path: string; text: string } | { path: string; blob: { sql: string; params?: SqlValue[] } }

// What a handler answers. status: 200 by default; Hodi only lets 2xx and 4xx through. body: any JSON. Or a zip: Hodi
// builds it, names it (letters, digits, . _ - only) and sends it as a download.
export type PluginResponse =
  | {
      status?: number
      body?: unknown
      headers?: { 'Cache-Control'?: string }
      // routes only, with permissions.households: « Changer de foyer », this device reads in that household from now on,
      // when the signed-in account has a profile there; « Qui lit ? » comes back. Anything else is refused and logged.
      moveDevice?: number
    }
  | { zip: { filename: string; entries: PluginZipEntry[] } }

export type PluginHandler = (request: PluginRequest, ctx: PluginContext) => Promise<PluginResponse>

// A request to a public route: nobody Hodi knows of asks, even when the device is signed in.
export type PublicRequest = Omit<PluginRequest, 'who'> & { who: null }

// A public route's answer may also sign the device in, with permissions.signIn: only with an account this same call
// made (ctx.accounts.create) or whose password it checked (ctx.accounts.checkPassword), never the server's admin. Hodi
// sets the session itself, after every plugin's checkSignIn; any other account is refused and logged.
export type PublicResponse = PluginResponse & { signIn?: number }

export type PublicHandler = (request: PublicRequest, ctx: PluginContext) => Promise<PublicResponse>

// A route table: 'METHOD /path', with :name for a part of the path. A POST, PUT or PATCH route may take a raw body
// instead of JSON (image/png, image/jpeg, image/webp or application/octet-stream), up to maxBody bytes and never more
// than 10 MB: request.body is then a Uint8Array.
//
// proof: true makes a route sensitive (it deletes data, it changes an account): Hodi runs it only once the person typed
// their own password, and with « Validation en deux étapes » their app's code, in Hodi's dialog (askToConfirm with
// proof, then api(path, { proof }) on the web). Hodi checks both, counting wrong ones as at Connexion; the handler
// never sees them, and a call without them is refused with 403 proof_required before it runs.
export type PluginRoutes = Record<
  string,
  | PluginHandler
  | { raw: true; maxBody: number; proof?: boolean; handler: PluginHandler }
  | { proof: boolean; handler: PluginHandler }
>

// Routes open to anyone: JSON bodies only, up to 64 KB.
export type PublicRoutes = Record<string, PublicHandler>

// What a plugin's server.js exports by default.
export interface ServerPlugin {
  // Its own schema changes, in order, never edited once released: the same rule as Hodi's.
  migrations?: readonly string[]
  // Served under /api/plugins/<id>/ to a signed-in profile it is meant for, while it is on.
  routes?: PluginRoutes
  // Served under /api/server/plugins/<id>/ to the server's admin only, while it is on.
  serverRoutes?: PluginRoutes
  // Served under /api/public/plugins/<id>/ to anyone, signed in or not, while it is on and once the setup is over,
  // when its manifest asks for permissions.publicRoutes. Hodi refuses a request from another site (403) and more than
  // 30 a minute from one address (429) before the plugin's code runs.
  publicRoutes?: PublicRoutes
  // Told of each article Hodi reads from its site for the first time, as the reader got it, while the plugin is on.
  // What it leaves running after it returns (a page to fetch, a row to write) has its time limit too.
  onArticle?: (article: PluginArticle, ctx: PluginContext) => Promise<void>
  // With permissions.signIn: asked at each sign-in of an account but the server admin's (Connexion, a plugin's
  // signIn, « J'ai déjà un compte », a new password). null lets it in; a key of the plugin's locales refuses it with
  // that message. Throwing or running out of time refuses it too, with Hodi's neutral message.
  checkSignIn?: (who: { accountId: number; householdId: number | null }, ctx: PluginContext) => Promise<string | null>
  // Work that runs by itself, every so many minutes (15 at least, a week at most), while the plugin is on: purging what
  // expired, a reminder… Its name is lowercase letters, digits and dashes. Hodi remembers when each last started, so a
  // restart never runs it early; one that is still running is never started again. It runs for no household (ctx's
  // household-scoped requests are refused) and never for a person: no AI, no sign-in.
  tasks?: Record<string, PluginTask>
  // The articles of each feed of plugin.json's feeds, by its key: read like a site's feed, every few minutes while a
  // household follows it, for no household. At most 100; each needs a title and an https link on the feed's site, and
  // opens with its summary and that link, never in the reader. Text is plain: tags are left out.
  feeds?: Record<string, (ctx: PluginContext) => Promise<PluginFeedArticle[]>>
  // What its AiButtons run, by the name each button gives: the only place ctx.ai answers, once per click. Hodi checks
  // first that the plugin is signed, on, meant for this profile, that the profile is an adult's and the household's
  // admin did not turn the plugin's AI off.
  aiActions?: Record<string, PluginAiAction>
  // Someone's data is gone from Hodi: delete what the plugin kept of it. A profile deleted (by the household's admin,
  // or with its account), an account deleted (« Supprimer ton compte »), a household removed (by the plugin that made
  // it, or emptied with its last adult). Every plugin that exports the hook is told, on or off, and asked again every
  // minute until it returns without throwing: make it safe to run twice.
  onProfileDeleted?: (deleted: { profileId: number; householdId: number }, ctx: PluginContext) => Promise<void>
  onAccountDeleted?: (deleted: { accountId: number }, ctx: PluginContext) => Promise<void>
  onHouseholdRemoved?: (removed: { householdId: number }, ctx: PluginContext) => Promise<void>
  // « Télécharger une copie » in Réglages › Compte et données: what the plugin keeps of this person, as JSON (512 KB
  // at most), put in the copy under plugins.<id>. profileId is the person's profile in that household, null without one.
  exportData?: (
    who: { accountId: number; profileId: number | null; householdId: number },
    ctx: PluginContext
  ) => Promise<unknown>
}

// A click on the plugin's AiButton: input is what the button was given (JSON, 16 KB at most), who the adult who
// clicked. Whatever it answers reaches the button's onAnswer.
export type PluginAiAction = (
  request: { input: unknown; who: { householdId: number; profileId: number } },
  ctx: PluginContext
) => Promise<unknown>

export interface PluginFeedArticle {
  title: string
  link: string
  summary?: string
  // An ISO date, or milliseconds since 1970.
  publishedAt?: string | number
  // An https picture.
  image?: string
}

export interface PluginTask {
  every: number
  run: (ctx: PluginContext) => Promise<void>
}
