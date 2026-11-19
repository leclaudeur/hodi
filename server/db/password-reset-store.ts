import { createHmac } from 'node:crypto'
import type { Database } from './database.ts'
import { drawCode } from './sign-in-code-store.ts'

// « Mot de passe oublié »: the code sent by e-mail, eight characters as « J'ai un code »'s, valid an hour and once. An
// account has one at a time: a new one replaces the one before. The table keeps a hash keyed with the server's secret,
// so a copy of the database alone cannot be turned back into codes.

export const RESET_CODE_LIFETIME = 60 * 60 * 1000
// One e-mail a minute at most for an account, so the form cannot fill someone's mailbox.
export const RESET_CODE_INTERVAL = 60 * 1000

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

  // A new code, or null when the account had one less than a minute ago.
  create(userId: number, now: number): string | null {
    this.#db.prepare('DELETE FROM password_resets WHERE expires_at <= ?').run(now)
    const last = this.#db.prepare('SELECT created_at FROM password_resets WHERE user_id = ?').get(userId) as
      { created_at: number } | undefined
    if (last && now - last.created_at < RESET_CODE_INTERVAL) return null
    const token = drawCode()
    this.#db
      .prepare(
        `INSERT INTO password_resets (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET token_hash = excluded.token_hash, created_at = excluded.created_at,
           expires_at = excluded.expires_at`
      )
      .run(this.#hash(token), userId, now, now + RESET_CODE_LIFETIME)
    return token
  }

  // Whose code it is, while it is valid; it stays valid.
  peek(token: string, now: number): number | null {
    const row = this.#db
      .prepare('SELECT user_id FROM password_resets WHERE token_hash = ? AND expires_at > ?')
      .get(this.#hash(token), now) as { user_id: number } | undefined
    return row?.user_id ?? null
  }

  // The code is used: it works no more.
  take(token: string, now: number): number | null {
    const row = this.#db
      .prepare('DELETE FROM password_resets WHERE token_hash = ? AND expires_at > ? RETURNING user_id')
      .get(this.#hash(token), now) as { user_id: number } | undefined
    return row?.user_id ?? null
  }
}
