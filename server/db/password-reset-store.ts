import { createHmac, randomBytes } from 'node:crypto'
import type { Database } from './database.ts'

// « Mot de passe oublié »: the link sent by e-mail, valid an hour and once. An account has one at a time: a new one
// replaces the one before. The table keeps a hash keyed with the server's secret, so a copy of the database alone
// cannot be turned back into links.

export const RESET_LINK_LIFETIME = 60 * 60 * 1000
// One e-mail a minute at most for an account, so the form cannot fill someone's mailbox.
export const RESET_LINK_INTERVAL = 60 * 1000

export const isResetToken = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)

export class PasswordResetStore {
  readonly #db: Database
  readonly #secret: Buffer

  constructor(db: Database, secret: Buffer) {
    this.#db = db
    this.#secret = secret
  }

  #hash(token: string) {
    return createHmac('sha256', this.#secret).update(`password-reset.${token}`).digest('base64url')
  }

  // A new link's token, or null when the account had one less than a minute ago.
  create(userId: number, now: number): string | null {
    this.#db.prepare('DELETE FROM password_resets WHERE expires_at <= ?').run(now)
    const last = this.#db.prepare('SELECT created_at FROM password_resets WHERE user_id = ?').get(userId) as
      { created_at: number } | undefined
    if (last && now - last.created_at < RESET_LINK_INTERVAL) return null
    const token = randomBytes(32).toString('base64url')
    this.#db
      .prepare(
        `INSERT INTO password_resets (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET token_hash = excluded.token_hash, created_at = excluded.created_at,
           expires_at = excluded.expires_at`
      )
      .run(this.#hash(token), userId, now, now + RESET_LINK_LIFETIME)
    return token
  }

  // Whose link it is, while it is valid; it stays valid.
  peek(token: string, now: number): number | null {
    const row = this.#db
      .prepare('SELECT user_id FROM password_resets WHERE token_hash = ? AND expires_at > ?')
      .get(this.#hash(token), now) as { user_id: number } | undefined
    return row?.user_id ?? null
  }

  // The link is used: it works no more.
  take(token: string, now: number): number | null {
    const row = this.#db
      .prepare('DELETE FROM password_resets WHERE token_hash = ? AND expires_at > ? RETURNING user_id')
      .get(this.#hash(token), now) as { user_id: number } | undefined
    return row?.user_id ?? null
  }
}
