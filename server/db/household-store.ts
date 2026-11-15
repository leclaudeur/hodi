import { type Language, isLanguage } from '../../shared/i18n.ts'
import { type Database, transaction } from './database.ts'
import type { PhotoType } from './profile-store.ts'
import { DEFAULT_ACCOUNT_ID, currentHouseholdId } from './household-scope.ts'

// One household per install: its name, where it lives and its AI. Made in the first-run screens, changed by the
// admin in Réglages > Foyer and Réglages > IA et crédits. The password columns of the household from before
// personal accounts stay in the table, unread.

export const MAX_HOUSEHOLD_NAME_LENGTH = 40

export interface HouseholdAi {
  provider: string
  key: string
  model: string | null
}

export interface Household {
  name: string
  // null: not set up yet, the app shows the first-run screens.
  setUpAt: number | null
  // null: the server's own.
  timeZone: string | null
  // Two letters, for the AI's web searches; null: none.
  country: string | null
  // The interface's, for every profile that did not pick its own.
  language: Language
  // 24: "21:00"; 12: "9:00 PM".
  hourCycle: HourCycle
  ai: HouseholdAi | null
  // Changes with the photo, so a browser asks again for the new one; null: no photo, the initial shows.
  photoVersion: number | null
}

export type HourCycle = 12 | 24

export const isHourCycle = (value: unknown): value is HourCycle => value === 12 || value === 24

interface HouseholdRow {
  name: string
  set_up_at: number | null
  time_zone: string | null
  country: string | null
  language: string
  hour_cycle: number
  ai_provider: string | null
  ai_key: string | null
  ai_model: string | null
  photo_version: number | null
}

export interface HouseholdSetup {
  name: string
  timeZone: string | null
  country: string | null
  // French unless chosen.
  language?: Language
  ai: HouseholdAi | null
}

// A name as typed, or null when it is none.
export const cleanHouseholdName = (value: unknown) => {
  if (typeof value !== 'string') return null
  const name = value.replace(/\s+/g, ' ').trim()
  return name.length > 0 && name.length <= MAX_HOUSEHOLD_NAME_LENGTH ? name : null
}

export class HouseholdStore {
  readonly #db: Database
  readonly #fixed: number | undefined

  // Without accountId, the household of the request being served (household-scope.ts).
  constructor(db: Database, accountId?: number) {
    this.#db = db
    this.#fixed = accountId
  }

  get #account(): number {
    return this.#fixed ?? currentHouseholdId()
  }

  // Every household of the server that is set up, the first one always: the core's, even before its setup.
  ids(): number[] {
    const rows = this.#db
      .prepare('SELECT id FROM accounts WHERE set_up_at IS NOT NULL OR id = ? ORDER BY id')
      .all(DEFAULT_ACCOUNT_ID) as { id: number }[]
    return rows.map(row => row.id)
  }

  get(): Household {
    const row = this.#db
      .prepare(
        `SELECT name, set_up_at, time_zone, country, language, hour_cycle, ai_provider, ai_key, ai_model,
         CASE WHEN photo IS NULL THEN NULL ELSE photo_version END AS photo_version
         FROM accounts WHERE id = ?`
      )
      .get(this.#account) as HouseholdRow | undefined
    if (!row) throw new Error(`Household ${this.#account} is missing`)
    return {
      name: row.name,
      setUpAt: row.set_up_at,
      timeZone: row.time_zone,
      country: row.country,
      language: isLanguage(row.language) ? row.language : 'fr',
      hourCycle: row.hour_cycle === 12 ? 12 : 24,
      ai: row.ai_provider && row.ai_key ? { provider: row.ai_provider, key: row.ai_key, model: row.ai_model } : null,
      photoVersion: row.photo_version
    }
  }

  // null photo: back to the initial.
  setPhoto(photo: { data: Buffer; type: PhotoType } | null, now: number) {
    this.#db
      .prepare('UPDATE accounts SET photo = ?, photo_type = ?, photo_version = ? WHERE id = ?')
      .run(photo?.data ?? null, photo?.type ?? null, photo ? now : null, this.#account)
  }

  photo(): { data: Buffer; type: PhotoType } | null {
    const row = this.#db
      .prepare('SELECT photo, photo_type FROM accounts WHERE id = ? AND photo IS NOT NULL')
      .get(this.#account) as { photo: Uint8Array; photo_type: PhotoType } | undefined
    return row ? { data: Buffer.from(row.photo), type: row.photo_type } : null
  }

  isSetUp() {
    return this.get().setUpAt !== null
  }

  // The first-run screens' answers, all at once; false when another device got there first.
  setUp(setup: HouseholdSetup, now: number) {
    return transaction(this.#db, () => {
      if (this.isSetUp()) return false
      this.#db
        .prepare(
          `UPDATE accounts SET name = ?, set_up_at = ?, time_zone = ?, country = ?, language = ?, ai_provider = ?,
           ai_key = ?, ai_model = ? WHERE id = ?`
        )
        .run(
          setup.name,
          now,
          setup.timeZone,
          setup.country,
          setup.language ?? 'fr',
          setup.ai?.provider ?? null,
          setup.ai?.key ?? null,
          setup.ai?.model ?? null,
          this.#account
        )
      return true
    })
  }

  setHourCycle(hourCycle: HourCycle) {
    this.#db.prepare('UPDATE accounts SET hour_cycle = ? WHERE id = ?').run(hourCycle, this.#account)
  }

  setLanguage(language: Language) {
    this.#db.prepare('UPDATE accounts SET language = ? WHERE id = ?').run(language, this.#account)
  }

  rename(name: string) {
    this.#db.prepare('UPDATE accounts SET name = ? WHERE id = ?').run(name, this.#account)
  }

  setRegion(region: { timeZone?: string | null; country?: string | null }) {
    const current = this.get()
    this.#db
      .prepare('UPDATE accounts SET time_zone = ?, country = ? WHERE id = ?')
      .run(
        region.timeZone === undefined ? current.timeZone : region.timeZone,
        region.country === undefined ? current.country : region.country,
        this.#account
      )
  }

  // null: no AI, its buttons are hidden.
  setAi(ai: HouseholdAi | null) {
    this.#db
      .prepare('UPDATE accounts SET ai_provider = ?, ai_key = ?, ai_model = ? WHERE id = ?')
      .run(ai?.provider ?? null, ai?.key ?? null, ai?.model ?? null, this.#account)
  }
}
