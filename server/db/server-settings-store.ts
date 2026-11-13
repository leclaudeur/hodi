import type { Database } from './database.ts'

// Serveur › Contenu: how long the server keeps what it fetches, in days. Each setting has its bounds and its default;
// a value outside them is refused.

export const CONTENT_SETTINGS = {
  // How long an article stays in the lists.
  articleDays: { min: 1, max: 14, byDefault: 3 },
  // How long a video or an episode stays in Vidéos.
  videoDays: { min: 7, max: 180, byDefault: 60 },
  // How long the server keeps the text read in Hodi; a saved article always keeps its own.
  textDays: { min: 1, max: 30, byDefault: 7 }
} as const

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
export const BACKUP_COPIES = { min: 1, max: 30, byDefault: 7 } as const

export const isValidCopies = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= BACKUP_COPIES.min && (value as number) <= BACKUP_COPIES.max

// Serveur › Contenu: how many sources a household may follow, all its profiles together, since each one is fetched.
// No row means no limit.
export const MAX_SOURCES = { min: 10, max: 1000 } as const

export const isValidMaxSources = (value: unknown): value is number | null =>
  value === null ||
  (Number.isInteger(value) && (value as number) >= MAX_SOURCES.min && (value as number) <= MAX_SOURCES.max)

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

  // « Plus tard » at the setup's household step: the server runs with no household, its admin in /server only, until
  // Serveur › Foyers creates one.
  householdLater(): boolean {
    const row = this.#db.prepare("SELECT value FROM server_settings WHERE key = 'householdLater'").get() as
      { value: number } | undefined
    return row?.value === 1
  }

  setHouseholdLater(later: boolean) {
    if (later)
      this.#db
        .prepare(
          "INSERT INTO server_settings (key, value) VALUES ('householdLater', 1) ON CONFLICT (key) DO UPDATE SET value = 1"
        )
        .run()
    else this.#db.prepare("DELETE FROM server_settings WHERE key = 'householdLater'").run()
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
// household may follow (null: no limit).
export interface PublicServerSettings extends ContentSettings {
  backupCopies: number
  maxSources: number | null
}

export const publicServerSettings = (store: ServerSettingsStore): PublicServerSettings => ({
  ...store.content(),
  backupCopies: store.backupCopies(),
  maxSources: store.maxSources()
})
