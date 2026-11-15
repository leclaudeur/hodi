import type { Database } from './database.ts'
import type { PhotoType } from './profile-store.ts'

// Serveur › Foyers and Comptes: who has an account and in which household, as the server's admin manages them. Never
// what anyone reads, nor their settings.

export interface ServerHousehold {
  id: number
  name: string
  createdAt: number
  // The household's admin profile's first name.
  admin: string | null
  adults: number
  young: number
  accounts: number
  // null: no photo, the initial shows.
  photoVersion: number | null
}

export interface ServerAccount {
  id: number
  email: string
  serverAdmin: boolean
  createdAt: number
  // Its profile and household; null for an account in no household.
  // photoVersion: null when it has no photo, the initial shows.
  profile: { id: number; name: string; role: 'admin' | 'member'; photoVersion: number | null } | null
  household: { id: number; name: string } | null
  // The last request of any of its signed-in devices, and how many there are.
  lastSeenAt: number | null
  devices: number
}

export class ServerPeopleStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  households(): ServerHousehold[] {
    return this.#db
      .prepare(
        `SELECT a.id, a.name, COALESCE(a.set_up_at, a.created_at) AS createdAt,
           (SELECT name FROM profiles WHERE account_id = a.id AND role = 'admin' ORDER BY id LIMIT 1) AS admin,
           (SELECT COUNT(*) FROM profiles WHERE account_id = a.id AND kind = 'adult') AS adults,
           (SELECT COUNT(*) FROM profiles WHERE account_id = a.id AND kind <> 'adult') AS young,
           (SELECT COUNT(*) FROM profiles WHERE account_id = a.id AND user_id IS NOT NULL) AS accounts,
           CASE WHEN a.photo IS NULL THEN NULL ELSE a.photo_version END AS photoVersion
         FROM accounts a WHERE a.set_up_at IS NOT NULL ORDER BY a.id`
      )
      .all() as unknown as ServerHousehold[]
  }

  accounts(): ServerAccount[] {
    const rows = this.#db
      .prepare(
        `SELECT u.id, u.email, u.server_admin, u.created_at, p.id AS profile_id, p.name AS profile_name, p.role,
           CASE WHEN p.photo IS NULL THEN NULL ELSE p.photo_version END AS photo_version,
           a.id AS household_id, a.name AS household_name,
           (SELECT MAX(last_seen_at) FROM user_devices d WHERE d.user_id = u.id) AS last_seen_at,
           (SELECT COUNT(*) FROM user_devices d WHERE d.user_id = u.id) AS devices
         FROM users u
         LEFT JOIN profiles p ON p.user_id = u.id
         LEFT JOIN accounts a ON a.id = p.account_id
         ORDER BY u.id`
      )
      .all() as {
      id: number
      email: string
      server_admin: number
      created_at: number
      profile_id: number | null
      profile_name: string | null
      role: 'admin' | 'member' | null
      photo_version: number | null
      household_id: number | null
      household_name: string | null
      last_seen_at: number | null
      devices: number
    }[]
    return rows.map(row => ({
      id: row.id,
      email: row.email,
      serverAdmin: row.server_admin === 1,
      createdAt: row.created_at,
      profile:
        row.profile_id === null
          ? null
          : {
              id: row.profile_id,
              name: row.profile_name ?? '',
              role: row.role ?? 'member',
              photoVersion: row.photo_version
            },
      household: row.household_id === null ? null : { id: row.household_id, name: row.household_name ?? '' },
      lastSeenAt: row.last_seen_at,
      devices: row.devices
    }))
  }

  // An account's profile photo, for its row in Serveur › Comptes: only a profile someone signs in to, never a young
  // one's.
  accountPhoto(profileId: number): { data: Buffer; type: PhotoType } | null {
    const row = this.#db
      .prepare('SELECT photo, photo_type FROM profiles WHERE id = ? AND user_id IS NOT NULL AND photo IS NOT NULL')
      .get(profileId) as { photo: Uint8Array; photo_type: PhotoType } | undefined
    return row ? { data: Buffer.from(row.photo), type: row.photo_type } : null
  }
}
