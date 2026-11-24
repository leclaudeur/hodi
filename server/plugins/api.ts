import type { PluginMailMessage } from './mail-message.ts'
import type { PublicServerSettings } from '../db/server-settings-store.ts'
import type { PluginArticle } from './articles.ts'
import type { SettingValues } from './manifest.ts'

// The plugin API 2, as a plugin's server.js sees it: what its handlers receive and answer. Types only, for the SDK
// (plugin-sdk/server.ts): the plugin's code runs in its sandbox (sandbox/), where Hodi builds these objects.

// A BLOB is a Uint8Array, both ways.
export type SqlValue = string | number | boolean | null | Uint8Array

// A text for the server's admin: one text, or one per language ({ fr, en }), of which each admin reads theirs (the
// French, or the other, when it lacks it).
export type PluginWritten = string | { fr?: string; en?: string }

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
  // it now. Only while a reader's call runs (a route of the app, an AiButton, exportData, onArticle): a task, a feed,
  // another hook or work left running after a call returns is refused with 'no_reader'.
  articles: {
    get: (id: string) => Promise<PluginArticle | null>
    page: (id: string) => Promise<{ url: string; html: string } | null>
  }
  // Serveur › Contenu, Sauvegardes and Général, read only, for every plugin: how many days an article, a video and a
  // read text are kept, how many nightly copies of the database, and the public site (publicHome, or null). Legal
  // pages say these numbers rather than writing them; a link to the public site uses that address.
  serverSettings: () => Promise<PublicServerSettings>
  // With permissions.mail: an e-mail through Serveur › E-mail. available() is false until the admin set it up, and
  // send() then refuses. One plain address, a one-line subject and plain text (paragraphs apart by an empty line,
  // <i>…</i> for italics), and if it likes a title, a small line above it, a code with a caption, one button and a
  // note, and the language of the words it adds (language: 'fr' | 'en', for someone without an account yet): Hodi
  // builds the e-mail in its own dark template, with a plain-text copy, signs it as Hodi (never the plugin), and
  // refuses past 50 e-mails an hour ('mail_limit'). appUrl() is the server's address set there, for a link in an
  // e-mail (such as a waiting list's confirmation), or null.
  mail: {
    available: () => Promise<boolean>
    appUrl: () => Promise<string | null>
    send: (message: PluginMailMessage) => Promise<void>
  }
  // With permissions.notify: a notification on a person's devices, through the same push as shares, in each device's
  // quiet hours and only where its « Plugins » switch is on. profileId, or accountId for the profile of an account;
  // within a person's own route or click, only them and the people they have a tie with (family, a share).
  // title (80 characters) and text (240), plain text; path:
  // where it opens under the plugin's page (#/settings/plugin/<id>/<path>). Three an hour and ten a day per profile:
  // 'too_many_notices' past them.
  notify?: (notice: {
    profileId?: number
    accountId?: number
    title: string
    text: string
    path?: string
  }) => Promise<void>
  // With permissions.notify and kinds in the manifest's serverNotifications: tells the server's admin of an event of
  // one of them, by e-mail, in push on the devices of their account, both or neither, as they chose for it in
  // Serveur › Notifications. title (80 characters) and text (240), plain text, one or one per language; path: one of the plugin's sections of
  // /server and maybe a screen under it (#/server/plugin/<id>/<path>), Serveur › Notifications without one.
  // 'unknown_type' for a kind the manifest does not list; fifty a day per plugin at most, 'too_many_notices' past them.
  // important: the plugin's key of a request someone waits on (« waitlist:12 », letters, digits and . _ : -, 100 at
  // most): it stays under « À traiter » until serverNoticeHandled(key), and the same key still waiting is not sent again.
  notifyServerAdmin?: (
    type: string,
    notice: { title: PluginWritten; text: PluginWritten; path?: string; important?: string }
  ) => Promise<void>
  // The request of that key is handled (the person invited, refused): its notice leaves « À traiter ».
  serverNoticeHandled?: (key: string) => Promise<void>
  // With permissions.ai, for a signed plugin ("Vérifié"): one question to Hodi's AI, only inside an aiActions
  // handler, which only a click on the plugin's AiButton (hodi:sdk) runs, and once per click: anywhere else it refuses
  // with 'ai_no_click', a second time with 'ai_already_asked'. Plain text: prompt (8000 characters), system (2000),
  // maxTokens (1 to 1024, 512 by default); the answer's text comes back, 8000 characters at most. It counts against
  // the profile's daily plugin cap and 10 an hour per plugin and profile. It refuses a question that does not fit with
  // 'ai_invalid_question', and one Hodi cannot ask with 'ai_unavailable', 'ai_off',
  // 'ai_limited', 'ai_refused' or 'ai_failed'. The plugin never sees the key, the provider or the model.
  ai?: {
    ask: (question: { prompt: string; system?: string; maxTokens?: number }) => Promise<string>
  }
  // With permissions.accounts: people's accounts, never with anything that could sign them in. create() makes an
  // account (null when the address has one already): with a password, a login of the plugin's (its own name for the
  // person, such as google:<id>, 200 characters at most), or both; with a login alone, the account has no password
  // (loginOnly) and its person comes in through the plugin; name, the person's first name as Mon compte shows it
  // (refused with 'invalid_account' when empty or too long). checkPassword() answers the account when the password is
  // right, null otherwise; it counts with the failed sign-ins of the address the call came from, and refuses with
  // 'throttled' past their limit. findByLogin() answers the account this plugin's login leads to. addLogin() gives
  // one to an account this same call made, checked or found (never the server's admin): false when the login leads
  // to another account. Each plugin only reads its own logins, and they go when the plugin is removed.
  // list() answers the accounts this plugin made, newest first. suspend(), resume() and remove() only take one of
  // them, else refuse with 'not_allowed': a suspended account is signed out everywhere and signs in nowhere (the
  // page shows the plugin's signIn.suspended text) until resumed; remove() deletes it as Serveur › Comptes does.
  accounts: {
    list: () => Promise<PluginAccount[]>
    suspend: (id: number) => Promise<void>
    resume: (id: number) => Promise<void>
    remove: (id: number) => Promise<void>
    get: (id: number) => Promise<PluginAccount | null>
    findByEmail: (email: string) => Promise<PluginAccount | null>
    create: (account: {
      email: string
      password?: string
      login?: string
      name?: string
    }) => Promise<PluginAccount | null>
    checkPassword: (email: string, password: string) => Promise<PluginAccount | null>
    findByLogin: (login: string) => Promise<PluginAccount | null>
    addLogin: (accountId: number, login: string) => Promise<boolean>
  }
}

// What a plugin learns of an account.
export interface PluginAccount {
  id: number
  email: string
  // Only for an account this plugin made (else null): its first name as set in Mon compte, and when it was made.
  name: string | null
  createdAt: number | null
  // true for an account made with a login alone: no password of its own until its person sets one.
  loginOnly: boolean
  serverAdmin: boolean
  // Made by this plugin: the only accounts it may suspend, resume or remove.
  mine: boolean
  // Suspended by the plugin that made it: signed out and refused at every sign-in.
  suspended: boolean
}

// Who asks, as Hodi checked it. No cookie, header or session reaches the plugin.
export interface PluginCaller {
  // The profile open on the device; null in the server's own space for an admin with no profile.
  profileId: number | null
  kind: 'adult' | 'teen' | 'child'
  // The server's admin.
  serverAdmin: boolean
  // The account signed in on the device, which may differ from the open profile's own on a shared device; null
  // without one.
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
  | { proof?: boolean; handler: PluginHandler }
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
  checkSignIn?: (who: { accountId: number }, ctx: PluginContext) => Promise<string | null>
  // Work that runs by itself, every so many minutes (15 at least, a week at most), while the plugin is on: purging what
  // expired, a reminder… Its name is lowercase letters, digits and dashes. Hodi remembers when each last started, so a
  // restart never runs it early; one that is still running is never started again. It runs for no reader
  // (ctx.articles is refused) and never for a person: no AI, no sign-in.
  tasks?: Record<string, PluginTask>
  // The articles of each feed of plugin.json's feeds, by its key: read like a site's feed, every few minutes while
  // someone follows it, for no reader. At most 100; each needs a title and an https link on the feed's site, and
  // opens with its summary and that link, never in the reader. Text is plain: tags are left out.
  feeds?: Record<string, (ctx: PluginContext) => Promise<PluginFeedArticle[]>>
  // What its AiButtons run, by the name each button gives: the only place ctx.ai answers, once per click. Hodi checks
  // first that the plugin is signed, on, meant for this profile, that the profile is an adult's and the server's
  // admin did not turn the plugin's AI off.
  aiActions?: Record<string, PluginAiAction>
  // Someone's data is gone from Hodi: delete what the plugin kept of it. A profile deleted (a young one by its parent,
  // or with its account), an account deleted (« Supprimer ton compte », Serveur › Comptes). When the last adult goes,
  // every profile and account is told one by one. Every plugin that exports the hook is told, on or off, and asked
  // again every minute until it returns without throwing: make it safe to run twice.
  onProfileDeleted?: (deleted: { profileId: number }, ctx: PluginContext) => Promise<void>
  onAccountDeleted?: (deleted: { accountId: number }, ctx: PluginContext) => Promise<void>
  // « Télécharger une copie » in Réglages › Compte et données: what the plugin keeps of this person, as JSON (512 KB
  // at most), put in the copy under plugins.<id>. profileId is the person's profile, null without one.
  exportData?: (who: { accountId: number; profileId: number | null }, ctx: PluginContext) => Promise<unknown>
  // The weekly report to the server's admin (Serveur › Notifications), on Monday morning: the plugin's own table
  // under its name, for the week from Monday to Sunday (YYYY-MM-DD). One to eight rows of plain text, each text one
  // or one per language: label (60 characters), value (30), and maybe its change since the week before (« +12 % »,
  // 20), green when good. Left out of the report when it fails or answers anything else.
  weeklyReport?: (
    week: { from: string; to: string },
    ctx: PluginContext
  ) => Promise<{
    rows: { label: PluginWritten; value: PluginWritten; change?: { text: PluginWritten; good: boolean } }[]
  }>
}

// A click on the plugin's AiButton: input is what the button was given (JSON, 16 KB at most), who the adult who
// clicked. Whatever it answers reaches the button's onAnswer.
export type PluginAiAction = (
  request: { input: unknown; who: { profileId: number } },
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
