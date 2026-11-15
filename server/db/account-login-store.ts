import type { Database } from './database.ts'

// The ways in a plugin keeps for accounts, besides their password (« Se connecter avec Google »): the plugin's own name
// for the person there, such as google:<id>. Each plugin only reads its own, and a name leads to one account.

export const MAX_LOGIN_LENGTH = 200

export const isLogin = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_LOGIN_LENGTH && !/[\s\p{Cc}]/u.test(value)

export class AccountLoginStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  accountOf(pluginId: string, login: string): number | null {
    const row = this.#db
      .prepare('SELECT user_id FROM account_logins WHERE plugin_id = ? AND login = ?')
      .get(pluginId, login) as { user_id: number } | undefined
    return row?.user_id ?? null
  }

  // false when this plugin's name already leads to an account.
  add(pluginId: string, login: string, userId: number, now: number): boolean {
    const { changes } = this.#db
      .prepare(
        'INSERT INTO account_logins (plugin_id, login, user_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING'
      )
      .run(pluginId, login, userId, now)
    return changes === 1
  }

  // The plugins that keep a way in for this account, for Réglages › Compte et données.
  pluginsOf(userId: number): string[] {
    return (
      this.#db
        .prepare('SELECT DISTINCT plugin_id FROM account_logins WHERE user_id = ? ORDER BY plugin_id')
        .all(userId) as { plugin_id: string }[]
    ).map(row => row.plugin_id)
  }
}
