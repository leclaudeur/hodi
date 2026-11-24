import { type Database, transaction } from './database.ts'
import { recordForget, rowKey } from './forget-log.ts'
import { DEFAULT_ACCOUNT_ID } from './server-row.ts'
import { currentReaders } from './reader-scope.ts'
import { CONFIG } from '../fixed-config.ts'

// Netflix-style profiles: one household (the password), up to five readers, each with their own
// preferences, "Enregistrés", reads, stats and alerts (UserStore, by profile). Articles, their texts and
// what the AI wrote stay shared.

export const MAX_NAME_LENGTH = CONFIG.profiles.nameMaxLength
// A square picture made small on the device: well under this.
export const MAX_PHOTO_BYTES = CONFIG.profiles.photoMaxSize
export const PHOTO_TYPES = ['image/webp', 'image/jpeg', 'image/png'] as const
export type PhotoType = (typeof PHOTO_TYPES)[number]

// The avatar's colour, without a photo: one of the topics' (see web/src/styles/tokens.css).
export const PROFILE_COLORS = [
  'belgium',
  'world',
  'tech',
  'science',
  'film-tv',
  'gaming',
  'ai',
  'broadcast',
  'sport',
  'music'
] as const
export type ProfileColor = (typeof PROFILE_COLORS)[number]
// The colours' names when the topics' ids were French, still sent by devices that have not updated yet.
const OLD_PROFILE_COLORS: Record<string, ProfileColor> = {
  belgique: 'belgium',
  monde: 'world',
  'films-series': 'film-tv',
  'jeux-video': 'gaming',
  ia: 'ai',
  musique: 'music'
}
export const OLD_PROFILE_COLOR_NAMES = Object.keys(OLD_PROFILE_COLORS)

// A profile colour, from its name or its name before; null for anything else.
export const profileColorOf = (value: unknown): ProfileColor | null =>
  PROFILE_COLORS.includes(value as ProfileColor)
    ? (value as ProfileColor)
    : typeof value === 'string' && Object.hasOwn(OLD_PROFILE_COLORS, value)
      ? (OLD_PROFILE_COLORS[value] ?? null)
      : null

// adult: a parent, who manages the young profiles. teen and child: young profiles, whose sources, time and AI the
// parents set; a child reads with a drawn avatar instead of a photo.
export const PROFILE_KINDS = ['adult', 'teen', 'child'] as const
export type ProfileKind = (typeof PROFILE_KINDS)[number]

// A child's avatar, drawn (web/src/assets/avatars/<name>.webp) on its colour.
export const PROFILE_AVATARS = [
  'fox',
  'pirate',
  'astronaut',
  'robot',
  'dragon',
  'panda',
  'owl',
  'kitten',
  'trex',
  'koala',
  'reporter',
  'scientist'
] as const
export type ProfileAvatar = (typeof PROFILE_AVATARS)[number]

export const isYoung = (profile: { kind: ProfileKind }) => profile.kind !== 'adult'

// admin: adds, changes and removes every profile, and the household's shared data. member: its own profile.
export type ProfileRole = 'admin' | 'member'

export interface Profile {
  id: number
  name: string
  color: ProfileColor
  role: ProfileRole
  kind: ProfileKind
  // A child's drawn avatar; null for the others.
  avatar: ProfileAvatar | null
  // Changes with the photo, so a browser asks again for the new one.
  photoVersion: number | null
  // Not opened yet since it was added: its first visit, on any device, opens on the guided tour.
  tourPending: boolean
  // Its person signs in with their own account. An adult without one waits for "Connecter un appareil".
  hasAccount: boolean
}

interface ProfileRow {
  id: number
  name: string
  color: ProfileColor
  role: ProfileRole
  kind: ProfileKind
  avatar: ProfileAvatar | null
  photo_version: number | null
  tour_pending: number
  has_account: number
}

const toProfile = (row: ProfileRow): Profile => ({
  id: row.id,
  name: row.name,
  color: row.color,
  role: row.role,
  kind: row.kind,
  avatar: row.avatar,
  photoVersion: row.photo_version,
  tourPending: row.tour_pending === 1,
  hasAccount: row.has_account === 1
})

// A name as typed, or null when it is none.
export const cleanName = (value: unknown) => {
  if (typeof value !== 'string') return null
  const name = value.replace(/\s+/g, ' ').trim()
  return name.length > 0 && name.length <= MAX_NAME_LENGTH ? name : null
}

const SELECT = `SELECT p.id, p.name, p.color, p.role, p.kind, p.avatar,
    CASE WHEN p.photo IS NULL THEN NULL ELSE p.photo_version END AS photo_version, p.tour_pending,
    p.user_id IS NOT NULL AS has_account
  FROM profiles p`

export class ProfileStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  // The profiles of the accounts the request reads as (reader-scope.ts), their children's, and for the server's admin
  // the adults' profiles that no account has yet. Outside a request, every one.
  list(): Profile[] {
    const readers = currentReaders()
    if (readers === null) return this.everyone()
    const ids = JSON.stringify(readers)
    const rows = this.#db
      .prepare(
        `${SELECT} WHERE (
           p.user_id IN (SELECT value FROM json_each(?))
           OR p.user_id IN (SELECT child_id FROM account_parents WHERE parent_id IN (SELECT value FROM json_each(?)))
           OR (p.user_id IS NULL AND EXISTS (
             SELECT 1 FROM users WHERE server_admin = 1 AND id IN (SELECT value FROM json_each(?))))
         ) ORDER BY p.position, p.id`
      )
      .all(ids, ids, ids) as unknown as ProfileRow[]
    return rows.map(toProfile)
  }

  // Every profile, whoever reads: for what crosses accounts (a share, its sender's name) and the server's admin.
  everyone(): Profile[] {
    const rows = this.#db.prepare(`${SELECT} ORDER BY p.position, p.id`).all() as unknown as ProfileRow[]
    return rows.map(toProfile)
  }

  // Any profile by its id, whoever reads; null when there is none.
  find(id: number): Profile | null {
    return this.everyone().find(profile => profile.id === id) ?? null
  }

  get(id: number): Profile | null {
    return this.list().find(profile => profile.id === id) ?? null
  }

  // A child without an avatar gets one no other profile has.
  create(
    name: string,
    color: ProfileColor,
    now: number,
    { kind = 'adult', avatar }: { kind?: ProfileKind; avatar?: ProfileAvatar } = {}
  ): Profile | null {
    return transaction(this.#db, () => {
      const profiles = this.everyone()
      const { lastInsertRowid } = this.#db
        .prepare(
          `INSERT INTO profiles (account_id, name, color, kind, avatar, position, created_at, tour_pending)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
        )
        .run(
          DEFAULT_ACCOUNT_ID,
          name,
          color,
          kind,
          kind === 'child' ? (avatar ?? this.#freeAvatar(profiles)) : null,
          profiles.length,
          now
        )
      return this.find(Number(lastInsertRowid))
    })
  }

  // A young profile has no PIN of its own, and a child no photo: changing the kind drops what it may not keep.
  // The admin stays an adult.
  update(id: number, change: { name?: string; color?: ProfileColor; kind?: ProfileKind; avatar?: ProfileAvatar }) {
    const profile = this.get(id)
    if (!profile) return null
    const kind = profile.role === 'admin' ? 'adult' : (change.kind ?? profile.kind)
    // A free avatar among the profiles the request sees: two children of different families may wear the same.
    const avatar =
      kind === 'child'
        ? (change.avatar ?? profile.avatar ?? this.#freeAvatar(this.list().filter(other => other.id !== id)))
        : null
    transaction(this.#db, () => {
      this.#db
        .prepare('UPDATE profiles SET name = ?, color = ?, kind = ?, avatar = ? WHERE id = ?')
        .run(change.name ?? profile.name, change.color ?? profile.color, kind, avatar, id)
      if (kind === 'child' && profile.photoVersion !== null) {
        this.#db
          .prepare('UPDATE profiles SET photo = NULL, photo_type = NULL, photo_version = NULL WHERE id = ?')
          .run(id)
      }
    })
    return this.get(id)
  }

  // The first avatar no other profile wears, or the first of all when every one is taken.
  #freeAvatar(others: Profile[]): ProfileAvatar {
    const worn = new Set(others.map(other => other.avatar))
    return PROFILE_AVATARS.find(avatar => !worn.has(avatar)) ?? PROFILE_AVATARS[0]
  }

  // null photo: back to the initial.
  setPhoto(id: number, photo: { data: Buffer; type: PhotoType } | null, now: number) {
    if (!this.get(id)) return null
    this.#db
      .prepare('UPDATE profiles SET photo = ?, photo_type = ?, photo_version = ? WHERE id = ?')
      .run(photo?.data ?? null, photo?.type ?? null, photo ? now : null, id)
    return this.get(id)
  }

  // Its first visit has begun: the tour is not offered again (Réglages still replays it).
  tourTaken(id: number) {
    if (!this.get(id)) return null
    this.#db.prepare('UPDATE profiles SET tour_pending = 0 WHERE id = ?').run(id)
    return this.get(id)
  }

  // The version a device's choice of the profile is signed with. It changes with the profile's account signing out
  // its devices (a new password), so the password is asked again on every device, and for an adult that the Code
  // parental opens, with that code. It holds the profile's creation time too: SQLite gives a deleted profile's id to
  // the next one, which a device's old choice must not open.
  lock(id: number): { version: string } | null {
    // The parent's code version apart from the rest, -1 once the profile is private: a sum would let turning private
    // on (pin_version + 1) give back the very version the code had.
    const row = this.#db
      .prepare(
        `SELECT p.pin_version + COALESCE(u.session_generation, 0) AS version,
           CASE WHEN p.kind = 'adult' AND COALESCE(u.private_profile, 0) = 0 THEN COALESCE(u.parental_code_version, 0)
             ELSE -1 END AS code,
           p.created_at AS createdAt
         FROM profiles p LEFT JOIN users u ON u.id = p.user_id
         WHERE p.id = ?`
      )
      .get(id) as { version: number; code: number; createdAt: number } | undefined
    return row ? { version: `${row.version}.${row.code}.${row.createdAt}` } : null
  }

  photo(id: number): { data: Buffer; type: PhotoType } | null {
    const row = this.#db
      .prepare('SELECT photo, photo_type FROM profiles WHERE id = ? AND photo IS NOT NULL')
      .get(id) as { photo: Uint8Array; photo_type: PhotoType } | undefined
    return row ? { data: Buffer.from(row.photo), type: row.photo_type } : null
  }

  // Its state goes with it. The admin stays: the household always has a reader who manages it.
  delete(id: number) {
    const profiles = this.everyone()
    const profile = profiles.find(candidate => candidate.id === id)
    if (profiles.length <= 1 || !profile || profile.role === 'admin') return false
    // Written down first, outside the database: a backup restored later deletes it again (forget-log.ts).
    const key = rowKey(this.#db, 'profiles', id)
    if (key) recordForget({ kind: 'profile', ...key })
    this.#db.prepare('DELETE FROM profiles WHERE id = ?').run(id)
    return true
  }
}
