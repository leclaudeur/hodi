import { type Language, isLanguage } from '../../shared/i18n.ts'
import { type Database, transaction } from './database.ts'
import { DEFAULT_ACCOUNT_ID } from './profile-store.ts'

// One household per install: its name, its password (every profile's), where it lives and its AI. Made in the
// first-run screens, changed by the admin in Réglages > Foyer and Réglages > IA et crédits.

export const MAX_HOUSEHOLD_NAME_LENGTH = 40

export interface HouseholdAi {
  provider: string
  key: string
  model: string | null
}

export interface Household {
  name: string
  // null: not set up yet, the app shows the first-run screens.
  passwordHash: string | null
  passwordChangedAt: number | null
  // Raised to sign out every device at once, see sessionKey.
  sessionGeneration: number
  // null: the server's own.
  timeZone: string | null
  // Two letters, for the AI's web searches; null: none.
  country: string | null
  // The interface's, for every profile that did not pick its own.
  language: Language
  // 24: "21:00"; 12: "9:00 PM".
  hourCycle: HourCycle
  ai: HouseholdAi | null
}

export type HourCycle = 12 | 24

export const isHourCycle = (value: unknown): value is HourCycle => value === 12 || value === 24

interface HouseholdRow {
  name: string
  password_hash: string | null
  password_changed_at: number | null
  session_generation: number
  time_zone: string | null
  country: string | null
  language: string
  hour_cycle: number
  ai_provider: string | null
  ai_key: string | null
  ai_model: string | null
}

export interface HouseholdSetup {
  name: string
  passwordHash: string
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
  readonly #account: number

  constructor(db: Database, accountId = DEFAULT_ACCOUNT_ID) {
    this.#db = db
    this.#account = accountId
  }

  get(): Household {
    const row = this.#db
      .prepare(
        `SELECT name, password_hash, password_changed_at, session_generation, time_zone, country, language, hour_cycle, ai_provider, ai_key, ai_model
         FROM accounts WHERE id = ?`
      )
      .get(this.#account) as HouseholdRow | undefined
    if (!row) throw new Error(`Household ${this.#account} is missing`)
    return {
      name: row.name,
      passwordHash: row.password_hash,
      passwordChangedAt: row.password_changed_at,
      sessionGeneration: row.session_generation,
      timeZone: row.time_zone,
      country: row.country,
      language: isLanguage(row.language) ? row.language : 'fr',
      hourCycle: row.hour_cycle === 12 ? 12 : 24,
      ai: row.ai_provider && row.ai_key ? { provider: row.ai_provider, key: row.ai_key, model: row.ai_model } : null
    }
  }

  isSetUp() {
    return this.get().passwordHash !== null
  }

  // The first-run screens' answers, all at once; false when another device got there first.
  setUp(setup: HouseholdSetup, now: number) {
    return transaction(this.#db, () => {
      if (this.isSetUp()) return false
      this.#db
        .prepare(
          `UPDATE accounts SET name = ?, password_hash = ?, password_changed_at = ?, time_zone = ?, country = ?,
           language = ?, ai_provider = ?, ai_key = ?, ai_model = ? WHERE id = ?`
        )
        .run(
          setup.name,
          setup.passwordHash,
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

  setPassword(passwordHash: string, now: number) {
    this.#db
      .prepare('UPDATE accounts SET password_hash = ?, password_changed_at = ? WHERE id = ?')
      .run(passwordHash, now, this.#account)
  }

  // Every session signed so far stops working; returns the new generation to sign this device's with.
  revokeSessions() {
    const row = this.#db
      .prepare(
        'UPDATE accounts SET session_generation = session_generation + 1 WHERE id = ? RETURNING session_generation'
      )
      .get(this.#account) as { session_generation: number } | undefined
    if (!row) throw new Error(`Household ${this.#account} is missing`)
    return row.session_generation
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
