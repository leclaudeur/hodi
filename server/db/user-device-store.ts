import type { Database } from './database.ts'

// The devices signed in with an account (Réglages > Compte et données > Appareils): what the browser said it was,
// and when it was last used. A device whose row is deleted signs in again.

export const MAX_USER_AGENT_LENGTH = 300
// A device's "Utilisé hier" moves at most this often: not one write per request.
export const LAST_SEEN_STEP = 60 * 60 * 1000

export interface UserDevice {
  id: number
  userAgent: string
  createdAt: number
  lastSeenAt: number
  // « Ne plus demander sur cet appareil »: its account's private profile opens here without the password.
  trusted: boolean
}

interface UserDeviceRow {
  id: number
  user_agent: string
  created_at: number
  last_seen_at: number
  trusted: number
}

const COLUMNS = 'id, user_agent, created_at, last_seen_at, trusted'

const toDevice = (row: UserDeviceRow): UserDevice => ({
  id: row.id,
  userAgent: row.user_agent,
  createdAt: row.created_at,
  lastSeenAt: row.last_seen_at,
  trusted: row.trusted === 1
})

export class UserDeviceStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  create(userId: number, userAgent: string, now: number): UserDevice {
    const { lastInsertRowid } = this.#db
      .prepare('INSERT INTO user_devices (user_id, user_agent, created_at, last_seen_at) VALUES (?, ?, ?, ?)')
      .run(userId, userAgent.slice(0, MAX_USER_AGENT_LENGTH), now, now)
    return this.get(userId, Number(lastInsertRowid))!
  }

  // null when the device is not, or no longer, one of this account's.
  get(userId: number, id: number): UserDevice | null {
    const row = this.#db.prepare(`SELECT ${COLUMNS} FROM user_devices WHERE id = ? AND user_id = ?`).get(id, userId) as
      UserDeviceRow | undefined
    return row ? toDevice(row) : null
  }

  // The most recently used first.
  list(userId: number): UserDevice[] {
    const rows = this.#db
      .prepare(`SELECT ${COLUMNS} FROM user_devices WHERE user_id = ? ORDER BY last_seen_at DESC, id DESC`)
      .all(userId) as unknown as UserDeviceRow[]
    return rows.map(toDevice)
  }

  touch(device: UserDevice, now: number) {
    if (now - device.lastSeenAt < LAST_SEEN_STEP) return
    this.#db.prepare('UPDATE user_devices SET last_seen_at = ? WHERE id = ?').run(now, device.id)
  }

  setTrusted(userId: number, id: number, trusted: boolean) {
    this.#db
      .prepare('UPDATE user_devices SET trusted = ? WHERE id = ? AND user_id = ?')
      .run(trusted ? 1 : 0, id, userId)
  }

  // « Redemander »: the password again on every device of the account.
  untrustAll(userId: number) {
    this.#db.prepare('UPDATE user_devices SET trusted = 0 WHERE user_id = ?').run(userId)
  }

  // false when there was no such device of this account.
  delete(userId: number, id: number) {
    return this.#db.prepare('DELETE FROM user_devices WHERE id = ? AND user_id = ?').run(id, userId).changes === 1
  }

  // Every device of the account ("Mot de passe oublié").
  deleteAll(userId: number) {
    this.#db.prepare('DELETE FROM user_devices WHERE user_id = ?').run(userId)
  }

  // Every device of the account but this one (a new password).
  deleteOthers(userId: number, keep: number) {
    this.#db.prepare('DELETE FROM user_devices WHERE user_id = ? AND id != ?').run(userId, keep)
  }
}
