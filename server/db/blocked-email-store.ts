import { createHash } from 'node:crypto'
import type { Database } from './database.ts'

// The e-mails of the accounts the server's admin blocked: none of them makes an account again, by any way in (a
// code, a plugin's sign-up, « Changer d'e-mail »). Kept as hashes: the address itself is gone with the account.
export class BlockedEmailStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  block(email: string, now: number) {
    this.#db.prepare('INSERT OR IGNORE INTO blocked_emails (hash, at) VALUES (?, ?)').run(hashOf(email), now)
  }

  has(email: string) {
    return this.#db.prepare('SELECT 1 FROM blocked_emails WHERE hash = ?').get(hashOf(email)) !== undefined
  }
}

// The cleaned address (lower case, trimmed) is what every way in compares.
const hashOf = (email: string) => createHash('sha256').update(email).digest('hex')
