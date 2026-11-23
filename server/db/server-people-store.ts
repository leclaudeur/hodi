import type { Database } from './database.ts'
import type { PhotoType } from './profile-store.ts'

// Serveur › Comptes: who has an account, as the server's admin manages them. Never what anyone reads, nor their
// settings.

export interface ServerAccount {
  id: number
  email: string
  serverAdmin: boolean
  createdAt: number
  // Its profile; null for an account with none yet.
  // photoVersion: null when it has no photo, the initial shows.
  profile: {
    id: number
    name: string
    role: 'admin' | 'member'
    kind: 'adult' | 'teen' | 'child'
    photoVersion: number | null
  } | null
  // The last request of any of its signed-in devices, and how many there are.
  lastSeenAt: number | null
  devices: number
}

export class ServerPeopleStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  accounts(): ServerAccount[] {
    const rows = this.#db
      .prepare(
        `SELECT u.id, u.email, u.server_admin, u.created_at, p.id AS profile_id, p.name AS profile_name, p.role, p.kind,
           CASE WHEN p.photo IS NULL THEN NULL ELSE p.photo_version END AS photo_version,
           (SELECT MAX(last_seen_at) FROM user_devices d WHERE d.user_id = u.id) AS last_seen_at,
           (SELECT COUNT(*) FROM user_devices d WHERE d.user_id = u.id) AS devices
         FROM users u
         LEFT JOIN profiles p ON p.user_id = u.id
         WHERE u.email IS NOT NULL
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
      kind: 'adult' | 'teen' | 'child' | null
      photo_version: number | null
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
              kind: row.kind ?? 'adult',
              photoVersion: row.photo_version
            },
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
