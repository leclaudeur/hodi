import type { PushTarget } from '../news/followed-alerts.ts'
import type { Database } from './database.ts'
import { CONFIG } from '../fixed-config.ts'

// Serveur › Notifications: for each server admin, how each kind of event reaches them, and the devices of their
// account that take the push ones. A kind they never chose comes by e-mail: the server's admin hears of what happens
// on it until they say otherwise, and push needs a device first.

export interface NoticeChoice {
  email: boolean
  push: boolean
}

export const DEFAULT_CHOICE: NoticeChoice = { email: true, push: false }

// The most devices one account keeps: the one not heard from for longest goes.
const MAX_DEVICES = CONFIG.serverNotices.devices

export class ServerNoticeStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  // Every kind the account chose for, by its id.
  choices(accountId: number): Map<string, NoticeChoice> {
    const rows = this.#db
      .prepare('SELECT type, email, push FROM server_notice_choices WHERE account_id = ?')
      .all(accountId) as { type: string; email: number; push: number }[]
    return new Map(rows.map(row => [row.type, { email: row.email === 1, push: row.push === 1 }]))
  }

  choice(accountId: number, type: string): NoticeChoice {
    return this.choices(accountId).get(type) ?? DEFAULT_CHOICE
  }

  choose(accountId: number, type: string, choice: NoticeChoice) {
    this.#db
      .prepare(
        `INSERT INTO server_notice_choices (account_id, type, email, push) VALUES (?, ?, ?, ?)
         ON CONFLICT (account_id, type) DO UPDATE SET email = excluded.email, push = excluded.push`
      )
      .run(accountId, type, choice.email ? 1 : 0, choice.push ? 1 : 0)
  }

  devices(accountId: number): PushTarget[] {
    const rows = this.#db
      .prepare('SELECT endpoint, p256dh, auth FROM server_push_devices WHERE account_id = ? ORDER BY updated_at')
      .all(accountId) as { endpoint: string; p256dh: string; auth: string }[]
    return rows.map(({ endpoint, p256dh, auth }) => ({ endpoint, keys: { p256dh, auth } }))
  }

  addDevice(accountId: number, target: PushTarget, now: number) {
    this.#db
      .prepare(
        `INSERT INTO server_push_devices (endpoint, account_id, p256dh, auth, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (endpoint) DO UPDATE SET
           account_id = excluded.account_id, p256dh = excluded.p256dh, auth = excluded.auth,
           updated_at = excluded.updated_at`
      )
      .run(target.endpoint, accountId, target.keys.p256dh, target.keys.auth, now)
    const extra = this.devices(accountId).slice(0, -MAX_DEVICES)
    for (const { endpoint } of extra) this.removeDevice(endpoint)
  }

  // Only the account's own device: another account's endpoint is left alone.
  removeDevice(endpoint: string, accountId?: number) {
    if (accountId === undefined) this.#db.prepare('DELETE FROM server_push_devices WHERE endpoint = ?').run(endpoint)
    else
      this.#db.prepare('DELETE FROM server_push_devices WHERE endpoint = ? AND account_id = ?').run(endpoint, accountId)
  }
}
