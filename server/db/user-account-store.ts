import { type Database, transaction } from './database.ts'
import { currentHouseholdId } from './household-scope.ts'

// Personal accounts: a person's own e-mail and password, which sign them in on any device. Not to be mixed up with
// UserStore, which keeps a profile's reading state, nor with the accounts table, which holds the household.
// The first account, made in the first-run screens, is the server's admin.

export const MAX_EMAIL_LENGTH = 254

export interface UserAccount {
  id: number
  email: string
  passwordHash: string
  passwordChangedAt: number
  // false for an account a plugin made with another way in (« Se connecter avec Google »), until a password is set.
  hasPassword: boolean
  // Raised to sign out every device of this account at once, see userSessionKey.
  sessionGeneration: number
  serverAdmin: boolean
  // When the account was made: SQLite may give a deleted account's id to a new one, and a session made before this
  // time was not made for it.
  createdAt: number
}

interface UserAccountRow {
  id: number
  email: string
  password_hash: string
  password_changed_at: number
  has_password: number
  session_generation: number
  server_admin: number
  created_at: number
}

const toAccount = (row: UserAccountRow): UserAccount => ({
  id: row.id,
  email: row.email,
  passwordHash: row.password_hash,
  passwordChangedAt: row.password_changed_at,
  hasPassword: row.has_password === 1,
  sessionGeneration: row.session_generation,
  serverAdmin: row.server_admin === 1,
  createdAt: row.created_at
})

// An address as typed, trimmed and in lower case, or null when it cannot be one. The check stays loose on purpose:
// the only proof an address works is a mail that arrives.
export const cleanEmail = (value: unknown) => {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  return email.length <= MAX_EMAIL_LENGTH && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

const COLUMNS =
  'id, email, password_hash, password_changed_at, has_password, session_generation, server_admin, created_at'

export class UserAccountStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  get(id: number): UserAccount | null {
    const row = this.#db.prepare(`SELECT ${COLUMNS} FROM users WHERE id = ?`).get(id) as UserAccountRow | undefined
    return row ? toAccount(row) : null
  }

  byEmail(email: string): UserAccount | null {
    const row = this.#db.prepare(`SELECT ${COLUMNS} FROM users WHERE email = ?`).get(email) as
      UserAccountRow | undefined
    return row ? toAccount(row) : null
  }

  // Whether anyone has an account yet: before that, the install signs in with the household's password, if any.
  any() {
    return this.#db.prepare('SELECT 1 FROM users LIMIT 1').get() !== undefined
  }

  // The server's first account, its admin; null when another device made one first.
  createServerAdmin(email: string, passwordHash: string, now: number): UserAccount | null {
    return transaction(this.#db, () => this.#insertServerAdmin(email, passwordHash, now))
  }

  // Inside a transaction: SQLite does not nest them.
  #insertServerAdmin(email: string, passwordHash: string, now: number) {
    if (this.any()) return null
    const { lastInsertRowid } = this.#db
      .prepare(
        `INSERT INTO users (email, password_hash, password_changed_at, server_admin, created_at)
         VALUES (?, ?, ?, 1, ?)`
      )
      .run(email, passwordHash, now, now)
    return this.get(Number(lastInsertRowid))
  }

  // Any other person's account, from a code ("J'ai un code"); null when the address has one already.
  // hasPassword false: passwordHash is of random bytes nobody knows, and the person signs in another way.
  create(email: string, passwordHash: string, now: number, { hasPassword = true } = {}): UserAccount | null {
    if (this.byEmail(email)) return null
    const { lastInsertRowid } = this.#db
      .prepare(
        'INSERT INTO users (email, password_hash, password_changed_at, has_password, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(email, passwordHash, now, hasPassword ? 1 : 0, now)
    return this.get(Number(lastInsertRowid))
  }

  // "Changer d'e-mail": the caller checked that no other account has it.
  setEmail(id: number, email: string) {
    this.#db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, id)
  }

  // The same password, hashed with stronger settings: not a change the person made, so its date stays.
  upgradePassword(id: number, passwordHash: string) {
    this.#db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id)
  }

  setPassword(id: number, passwordHash: string, now: number) {
    this.#db
      .prepare(
        `UPDATE users SET password_hash = ?, password_changed_at = ?, has_password = 1,
           session_generation = session_generation + 1 WHERE id = ?`
      )
      .run(passwordHash, now, id)
  }

  // Every session of this account stops working; returns the new generation to sign this device's with.
  revokeSessions(id: number) {
    const row = this.#db
      .prepare('UPDATE users SET session_generation = session_generation + 1 WHERE id = ? RETURNING session_generation')
      .get(id) as { session_generation: number } | undefined
    if (!row) throw new Error(`Account ${id} is missing`)
    return row.session_generation
  }

  // Every profile of this account, in every household.
  profilesOf(id: number): { profileId: number; householdId: number }[] {
    return (
      this.#db.prepare('SELECT id, account_id FROM profiles WHERE user_id = ? ORDER BY id').all(id) as {
        id: number
        account_id: number
      }[]
    ).map(row => ({ profileId: row.id, householdId: row.account_id }))
  }

  // The profile this account reads with in the household, or null.
  profileOf(id: number, householdId = currentHouseholdId()): number | null {
    const row = this.#db
      .prepare('SELECT id FROM profiles WHERE account_id = ? AND user_id = ?')
      .get(householdId, id) as { id: number } | undefined
    return row?.id ?? null
  }

  // The household this account reads in, or null without a profile. The core has one household; with a plugin's
  // others, the account's first.
  householdOf(id: number): number | null {
    const row = this.#db.prepare('SELECT account_id FROM profiles WHERE user_id = ? ORDER BY id LIMIT 1').get(id) as
      { account_id: number } | undefined
    return row?.account_id ?? null
  }

  // The account that reads with this profile, or null.
  ofProfile(profileId: number): UserAccount | null {
    const row = this.#db.prepare('SELECT user_id FROM profiles WHERE id = ?').get(profileId) as
      { user_id: number | null } | undefined
    return row?.user_id ? this.get(row.user_id) : null
  }

  linkProfile(id: number, profileId: number) {
    this.#db.prepare('UPDATE profiles SET user_id = ? WHERE id = ?').run(id, profileId)
  }
}
