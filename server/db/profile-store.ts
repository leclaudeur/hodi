import { type Database, transaction } from './database.ts'
import { recordForget, rowKey } from './forget-log.ts'
import { currentHouseholdId } from './household-scope.ts'

// Netflix-style profiles: one household (the password), up to five readers, each with their own
// preferences, "Enregistrés", reads, stats and alerts (UserStore, by profile). Articles, their texts and
// what the AI wrote stay shared.

export const MAX_PROFILES = 5
export const MAX_NAME_LENGTH = 24
// A square picture made small on the device: well under this.
export const MAX_PHOTO_BYTES = 200_000
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

export class ProfileStore {
  readonly #db: Database
  readonly #fixed: number | undefined

  // Without accountId, the household of the request being served (household-scope.ts).
  constructor(db: Database, accountId?: number) {
    this.#db = db
    this.#fixed = accountId
  }

  get #account(): number {
    return this.#fixed ?? currentHouseholdId()
  }

  list(): Profile[] {
    const rows = this.#db
      .prepare(
        `SELECT p.id, p.name, p.color, p.role, p.kind, p.avatar,
           CASE WHEN p.photo IS NULL THEN NULL ELSE p.photo_version END AS photo_version, p.tour_pending,
           p.user_id IS NOT NULL AS has_account
         FROM profiles p JOIN accounts a ON a.id = p.account_id WHERE p.account_id = ? ORDER BY p.position, p.id`
      )
      .all(this.#account) as unknown as ProfileRow[]
    return rows.map(toProfile)
  }

  // The household a profile belongs to, whichever household this store is for; null when it is gone.
  householdOf(id: number): number | null {
    const row = this.#db.prepare('SELECT account_id FROM profiles WHERE id = ?').get(id) as
      { account_id: number } | undefined
    return row?.account_id ?? null
  }

  get(id: number): Profile | null {
    return this.list().find(profile => profile.id === id) ?? null
  }

  // null when the household already has MAX_PROFILES. A child without an avatar gets one no other profile has.
  create(
    name: string,
    color: ProfileColor,
    now: number,
    { kind = 'adult', avatar }: { kind?: ProfileKind; avatar?: ProfileAvatar } = {}
  ): Profile | null {
    return transaction(this.#db, () => {
      const profiles = this.list()
      if (profiles.length >= MAX_PROFILES) return null
      const { lastInsertRowid } = this.#db
        .prepare(
          `INSERT INTO profiles (account_id, name, color, kind, avatar, position, created_at, tour_pending)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
        )
        .run(
          this.#account,
          name,
          color,
          kind,
          kind === 'child' ? (avatar ?? this.#freeAvatar(profiles)) : null,
          profiles.length,
          now
        )
      return this.get(Number(lastInsertRowid))
    })
  }

  // A young profile has no PIN of its own, and a child no photo: changing the kind drops what it may not keep.
  // The admin stays an adult.
  update(id: number, change: { name?: string; color?: ProfileColor; kind?: ProfileKind; avatar?: ProfileAvatar }) {
    const profile = this.get(id)
    if (!profile) return null
    const kind = profile.role === 'admin' ? 'adult' : (change.kind ?? profile.kind)
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
  // its devices (a new password), so the password is asked again on every device. It holds the profile's creation
  // time too: SQLite gives a deleted profile's id to the next one, which a device's old choice must not open.
  lock(id: number): { version: string } | null {
    const row = this.#db
      .prepare(
        `SELECT p.pin_version + a.parental_pin_version + COALESCE(u.session_generation, 0) AS version,
           p.created_at AS createdAt
         FROM profiles p JOIN accounts a ON a.id = p.account_id LEFT JOIN users u ON u.id = p.user_id
         WHERE p.id = ? AND p.account_id = ?`
      )
      .get(id, this.#account) as { version: number; createdAt: number } | undefined
    return row ? { version: `${row.version}.${row.createdAt}` } : null
  }

  photo(id: number): { data: Buffer; type: PhotoType } | null {
    const row = this.#db
      .prepare('SELECT photo, photo_type FROM profiles WHERE id = ? AND account_id = ? AND photo IS NOT NULL')
      .get(id, this.#account) as { photo: Uint8Array; photo_type: PhotoType } | undefined
    return row ? { data: Buffer.from(row.photo), type: row.photo_type } : null
  }

  // « Passer le rôle d'admin »: an adult with an account of their own becomes the household's admin, the admin until
  // now a member. false when that profile cannot be.
  handOverAdmin(id: number) {
    const target = this.get(id)
    if (!target || target.kind !== 'adult' || !target.hasAccount || target.role === 'admin') return false
    transaction(this.#db, () => {
      this.#db.prepare("UPDATE profiles SET role = 'member' WHERE account_id = ? AND role = 'admin'").run(this.#account)
      this.#db.prepare("UPDATE profiles SET role = 'admin' WHERE id = ? AND account_id = ?").run(id, this.#account)
    })
    return true
  }

  // Its state goes with it. The admin stays: the household always has a reader who manages it.
  delete(id: number) {
    const profiles = this.list()
    const profile = profiles.find(candidate => candidate.id === id)
    if (profiles.length <= 1 || !profile || profile.role === 'admin') return false
    // Written down first, outside the database: a backup restored later deletes it again (forget-log.ts).
    const key = rowKey(this.#db, 'profiles', id)
    if (key) recordForget({ kind: 'profile', ...key, householdId: this.#account })
    this.#db.prepare('DELETE FROM profiles WHERE id = ?').run(id)
    return true
  }
}
