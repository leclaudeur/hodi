import type { Database } from './database.ts'
import { LAST_SEEN_STEP, MAX_USER_AGENT_LENGTH } from './user-device-store.ts'

// A young profile's own devices (Réglages > Profils > its form > Appareils): linked by a parent with a code, each
// one opens that profile only. A device unused for this long is no longer linked, and asks for a new code.
export const PROFILE_DEVICE_IDLE = 90 * 24 * 60 * 60 * 1000

export interface ProfileDevice {
  id: number
  profileId: number
  userAgent: string
  createdAt: number
  lastSeenAt: number
  // Linked before cookies named the row's creation time: its old cookie still opens it, and is replaced at once.
  legacy: boolean
}

interface ProfileDeviceRow {
  id: number
  profile_id: number
  user_agent: string
  created_at: number
  last_seen_at: number
  legacy: number
}

const COLUMNS = 'id, profile_id, user_agent, created_at, last_seen_at, legacy'

const toDevice = (row: ProfileDeviceRow): ProfileDevice => ({
  id: row.id,
  profileId: row.profile_id,
  userAgent: row.user_agent,
  createdAt: row.created_at,
  lastSeenAt: row.last_seen_at,
  legacy: row.legacy === 1
})

export class ProfileDeviceStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  create(profileId: number, userAgent: string, now: number): ProfileDevice {
    const { lastInsertRowid } = this.#db
      .prepare('INSERT INTO profile_devices (profile_id, user_agent, created_at, last_seen_at) VALUES (?, ?, ?, ?)')
      .run(profileId, userAgent.slice(0, MAX_USER_AGENT_LENGTH), now, now)
    return this.#byId(Number(lastInsertRowid))!
  }

  #byId(id: number) {
    const row = this.#db.prepare(`SELECT ${COLUMNS} FROM profile_devices WHERE id = ?`).get(id) as
      ProfileDeviceRow | undefined
    return row ? toDevice(row) : null
  }

  // null when the device is not linked, or no longer: removed, its profile deleted, or unused for 90 days (its row
  // then goes).
  get(id: number, now: number): ProfileDevice | null {
    const device = this.#byId(id)
    if (device && now - device.lastSeenAt >= PROFILE_DEVICE_IDLE) {
      this.#db.prepare('DELETE FROM profile_devices WHERE id = ?').run(id)
      return null
    }
    return device
  }

  // The most recently used first, without those gone idle.
  list(profileId: number, now: number): ProfileDevice[] {
    const rows = this.#db
      .prepare(
        `SELECT ${COLUMNS} FROM profile_devices WHERE profile_id = ? AND last_seen_at > ? ORDER BY last_seen_at DESC, id DESC`
      )
      .all(profileId, now - PROFILE_DEVICE_IDLE) as unknown as ProfileDeviceRow[]
    return rows.map(toDevice)
  }

  // true when it moved: the device's cookie is then sent again, so that its 90 days start over.
  touch(device: ProfileDevice, now: number) {
    if (now - device.lastSeenAt < LAST_SEEN_STEP) return false
    this.#db.prepare('UPDATE profile_devices SET last_seen_at = ? WHERE id = ?').run(now, device.id)
    return true
  }

  // false when there was no such device of this profile.
  delete(profileId: number, id: number) {
    return (
      this.#db.prepare('DELETE FROM profile_devices WHERE id = ? AND profile_id = ?').run(id, profileId).changes === 1
    )
  }
}
