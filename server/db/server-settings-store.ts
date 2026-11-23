import type { Database } from './database.ts'
import { CONFIG } from '../fixed-config.ts'

// Serveur › Contenu: how long the server keeps what it fetches, in days. Each setting has its bounds and its default;
// a value outside them is refused.

export const CONTENT_SETTINGS = {
  // How long an article stays in the lists.
  articleDays: {
    min: CONFIG.serverSettings.articleDaysMin,
    max: CONFIG.serverSettings.articleDaysMax,
    byDefault: CONFIG.serverSettings.articleDaysDefault
  },
  // How long a video or an episode stays in Vidéos.
  videoDays: {
    min: CONFIG.serverSettings.videoDaysMin,
    max: CONFIG.serverSettings.videoDaysMax,
    byDefault: CONFIG.serverSettings.videoDaysDefault
  },
  // How long the server keeps the text read in Hodi; a saved article always keeps its own.
  textDays: {
    min: CONFIG.serverSettings.textDaysMin,
    max: CONFIG.serverSettings.textDaysMax,
    byDefault: CONFIG.serverSettings.textDaysDefault
  }
}

export type ContentKey = keyof typeof CONTENT_SETTINGS
export type ContentSettings = Record<ContentKey, number>

export const isContentKey = (value: unknown): value is ContentKey =>
  typeof value === 'string' && Object.hasOwn(CONTENT_SETTINGS, value)

export const isValidContent = (key: ContentKey, value: unknown): value is number =>
  Number.isInteger(value) &&
  (value as number) >= CONTENT_SETTINGS[key].min &&
  (value as number) <= CONTENT_SETTINGS[key].max

export const DEFAULT_CONTENT = Object.fromEntries(
  Object.entries(CONTENT_SETTINGS).map(([key, { byDefault }]) => [key, byDefault])
) as ContentSettings

// Serveur › Sauvegardes: how many copies of the database are kept, one a night (and those made by hand).
export const BACKUP_COPIES = {
  min: CONFIG.serverSettings.backupCopiesMin,
  max: CONFIG.serverSettings.backupCopiesMax,
  byDefault: CONFIG.serverSettings.backupCopiesDefault
}

export const isValidCopies = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= BACKUP_COPIES.min && (value as number) <= BACKUP_COPIES.max

// Serveur › Contenu: how many sources a household may follow, all its profiles together, since each one is fetched.
// No row means no limit.
export const MAX_SOURCES = {
  min: CONFIG.serverSettings.maxSourcesMin,
  max: CONFIG.serverSettings.maxSourcesMax
}

export const isValidMaxSources = (value: unknown): value is number | null =>
  value === null ||
  (Number.isInteger(value) && (value as number) >= MAX_SOURCES.min && (value as number) <= MAX_SOURCES.max)

// Serveur › Général: a site's address, https (http only for a local test), without a path's trailing slash. Null when
// it is not one.
export const cleanPublicHome = (value: unknown): string | null => {
  if (typeof value !== 'string' || value.length > 200) return null
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (url.username || url.password || url.search || url.hash) return null
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  } catch {
    return null
  }
}

export class ServerSettingsStore {
  readonly #db: Database
  // Read on every list: kept in memory, written through.
  #content: ContentSettings | null = null

  constructor(db: Database) {
    this.#db = db
  }

  content(): ContentSettings {
    if (this.#content) return this.#content
    const rows = this.#db.prepare('SELECT key, value FROM server_settings').all() as { key: string; value: number }[]
    const content = { ...DEFAULT_CONTENT }
    for (const { key, value } of rows) if (isContentKey(key) && isValidContent(key, value)) content[key] = value
    this.#content = content
    return content
  }

  backupCopies(): number {
    const row = this.#db.prepare("SELECT value FROM server_settings WHERE key = 'backupCopies'").get() as
      { value: number } | undefined
    return row && isValidCopies(row.value) ? row.value : BACKUP_COPIES.byDefault
  }

  maxSources(): number | null {
    const row = this.#db.prepare("SELECT value FROM server_settings WHERE key = 'maxSources'").get() as
      { value: number } | undefined
    return row && isValidMaxSources(row.value) ? row.value : null
  }

  // A household already above a lower limit keeps its sources: it only cannot add one.
  setMaxSources(value: number | null) {
    if (value === null) this.#db.prepare("DELETE FROM server_settings WHERE key = 'maxSources'").run()
    else
      this.#db
        .prepare(
          "INSERT INTO server_settings (key, value) VALUES ('maxSources', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value"
        )
        .run(value)
  }

  setBackupCopies(value: number) {
    this.#db
      .prepare(
        "INSERT INTO server_settings (key, value) VALUES ('backupCopies', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value"
      )
      .run(value)
  }

  // The Monday of the last week the weekly report went for (YYYY-MM-DD), kept as 20261109; null before the first.
  weeklyReportSent(): string | null {
    const row = this.#db.prepare("SELECT value FROM server_settings WHERE key = 'weeklyReportSent'").get() as
      { value: number } | undefined
    const day = String(row?.value ?? '')
    return /^\d{8}$/.test(day) ? `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}` : null
  }

  setWeeklyReportSent(monday: string) {
    this.#db
      .prepare(
        "INSERT INTO server_settings (key, value) VALUES ('weeklyReportSent', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value"
      )
      .run(Number(monday.replace(/-/g, '')))
  }

  // Serveur › Général: Hodi's own address and the public site, each null until the admin gives it.
  addresses(): { appUrl: string | null; publicHome: string | null } {
    const row = this.#db.prepare('SELECT app_url, public_home FROM server_addresses WHERE id = 1').get() as
      { app_url: string | null; public_home: string | null } | undefined
    return { appUrl: row?.app_url ?? null, publicHome: row?.public_home ?? null }
  }

  publicHome(): string | null {
    return this.addresses().publicHome
  }

  setAddresses(changes: { appUrl?: string | null; publicHome?: string | null }) {
    const next = { ...this.addresses(), ...changes }
    this.#db
      .prepare(
        `INSERT INTO server_addresses (id, app_url, public_home) VALUES (1, ?, ?)
         ON CONFLICT (id) DO UPDATE SET app_url = excluded.app_url, public_home = excluded.public_home`
      )
      .run(next.appUrl, next.publicHome)
    return next
  }

  setContent(changes: Partial<ContentSettings>) {
    const upsert = this.#db.prepare(
      'INSERT INTO server_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'
    )
    for (const [key, value] of Object.entries(changes)) if (isContentKey(key)) upsert.run(key, value)
    this.#content = null
    return this.content()
  }
}

// What anyone may read of the server's settings, a plugin or a page signed in or not (legal pages say these numbers):
// how long the server keeps what it fetches, how many nightly copies of the database it keeps, and how many sources a
// household may follow (null: no limit), and the public site of Serveur › Général (null until the admin gives it).
export interface PublicServerSettings extends ContentSettings {
  backupCopies: number
  maxSources: number | null
  publicHome: string | null
}

export const publicServerSettings = (store: ServerSettingsStore): PublicServerSettings => ({
  ...store.content(),
  backupCopies: store.backupCopies(),
  maxSources: store.maxSources(),
  publicHome: store.publicHome()
})
