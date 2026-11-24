import type { Database } from './database.ts'

export interface AccountAi {
  provider: string
  key: string
  model: string | null
}

interface AiRow {
  ai_provider: string | null
  ai_key: string | null
  ai_model: string | null
}

const toAi = (row: AiRow | undefined): AccountAi | null =>
  row?.ai_provider && row.ai_key ? { provider: row.ai_provider, key: row.ai_key, model: row.ai_model } : null

// Each account's own AI key (Mon compte › IA et crédits): its calls go on its own bill. A young profile has no account,
// so no AI.
export class AccountAiStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  get(accountId: number): AccountAi | null {
    return toAi(
      this.#db.prepare('SELECT ai_provider, ai_key, ai_model FROM users WHERE id = ?').get(accountId) as
        AiRow | undefined
    )
  }

  // null: no AI, its buttons are hidden.
  set(accountId: number, ai: AccountAi | null) {
    this.#db
      .prepare('UPDATE users SET ai_provider = ?, ai_key = ?, ai_model = ? WHERE id = ?')
      .run(ai?.provider ?? null, ai?.key ?? null, ai?.model ?? null, accountId)
  }

  // The account a profile reads with, and its key; null for a profile with no account, and for a teen's or a child's,
  // which has no AI.
  ofProfile(profileId: number): { accountId: number; ai: AccountAi | null } | null {
    const row = this.#db
      .prepare(
        `SELECT users.id, users.ai_provider, users.ai_key, users.ai_model
         FROM profiles JOIN users ON users.id = profiles.user_id WHERE profiles.id = ? AND profiles.kind = 'adult'`
      )
      .get(profileId) as (AiRow & { id: number }) | undefined
    return row ? { accountId: row.id, ai: toAi(row) } : null
  }
}
