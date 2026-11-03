import { type Database, transaction } from './database.ts'

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
  'belgique',
  'monde',
  'tech',
  'science',
  'films-series',
  'jeux-video',
  'ia',
  'broadcast',
  'sport',
  'musique'
] as const
export type ProfileColor = (typeof PROFILE_COLORS)[number]

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

// A code is asked before it opens: its own PIN or the Code parental.
export const isGuarded = (profile: { locked: boolean; parental: boolean }) => profile.locked || profile.parental

// The household of today: profiles live in it until there are several.
export const DEFAULT_ACCOUNT_ID = 1

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
  // Its own PIN is asked before it opens: a private profile.
  locked: boolean
  // The household's Code parental is asked before it opens: an adult without its own PIN, in a household with
  // young profiles and that code.
  parental: boolean
  // Changes with the photo, so a browser asks again for the new one.
  photoVersion: number | null
  // Not opened yet since it was added: its first visit, on any device, opens on the guided tour.
  tourPending: boolean
}

interface ProfileRow {
  id: number
  name: string
  color: ProfileColor
  role: ProfileRole
  kind: ProfileKind
  avatar: ProfileAvatar | null
  locked: number
  parental: number
  photo_version: number | null
  tour_pending: number
}

const toProfile = (row: ProfileRow): Profile => ({
  id: row.id,
  name: row.name,
  color: row.color,
  role: row.role,
  kind: row.kind,
  avatar: row.avatar,
  locked: row.locked === 1,
  parental: row.parental === 1,
  photoVersion: row.photo_version,
  tourPending: row.tour_pending === 1
})

// A name as typed, or null when it is none.
export const cleanName = (value: unknown) => {
  if (typeof value !== 'string') return null
  const name = value.replace(/\s+/g, ' ').trim()
  return name.length > 0 && name.length <= MAX_NAME_LENGTH ? name : null
}

export class ProfileStore {
  readonly #db: Database
  readonly #account: number

  constructor(db: Database, accountId = DEFAULT_ACCOUNT_ID) {
    this.#db = db
    this.#account = accountId
  }

  list(): Profile[] {
    const rows = this.#db
      .prepare(
        `SELECT p.id, p.name, p.color, p.role, p.kind, p.avatar, p.pin_hash IS NOT NULL AS locked,
           (p.pin_hash IS NULL AND p.kind = 'adult' AND a.parental_pin_hash IS NOT NULL
             AND EXISTS (SELECT 1 FROM profiles y WHERE y.account_id = a.id AND y.kind != 'adult')) AS parental,
           CASE WHEN p.photo IS NULL THEN NULL ELSE p.photo_version END AS photo_version, p.tour_pending
         FROM profiles p JOIN accounts a ON a.id = p.account_id WHERE p.account_id = ? ORDER BY p.position, p.id`
      )
      .all(this.#account) as unknown as ProfileRow[]
    return rows.map(toProfile)
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
      if (kind !== 'adult') this.#guardAdults(profiles)
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
      if (kind !== 'adult') this.#guardAdults(this.list().filter(other => other.id !== id))
      this.#db
        .prepare('UPDATE profiles SET name = ?, color = ?, kind = ?, avatar = ? WHERE id = ?')
        .run(change.name ?? profile.name, change.color ?? profile.color, kind, avatar, id)
      if (kind !== 'adult' && profile.locked) this.setPin(id, null)
      if (kind === 'child' && profile.photoVersion !== null) {
        this.#db
          .prepare('UPDATE profiles SET photo = NULL, photo_type = NULL, photo_version = NULL WHERE id = ?')
          .run(id)
      }
    })
    return this.get(id)
  }

  // The household's first young profile: the Code parental, if there is one, now guards the adults, and the devices
  // already open on them ask for it.
  #guardAdults(others: Profile[]) {
    if (others.some(isYoung)) return
    this.#db
      .prepare(
        'UPDATE accounts SET parental_pin_version = parental_pin_version + 1 WHERE id = ? AND parental_pin_hash IS NOT NULL'
      )
      .run(this.#account)
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

  // The PIN's hash, and the version a device's choice of the profile is signed with: it changes with the profile's
  // PIN and with the Code parental, so a new one is asked again on every device. parental: the Code parental's
  // hash when that is what opens the profile.
  lock(id: number): { hash: string | null; version: number; parental: string | null } | null {
    const row = this.#db
      .prepare(
        `SELECT p.pin_hash, p.pin_version + a.parental_pin_version AS version, a.parental_pin_hash
         FROM profiles p JOIN accounts a ON a.id = p.account_id WHERE p.id = ? AND p.account_id = ?`
      )
      .get(id, this.#account) as
      { pin_hash: string | null; version: number; parental_pin_hash: string | null } | undefined
    if (!row) return null
    return {
      hash: row.pin_hash,
      version: row.version,
      parental: this.get(id)?.parental ? row.parental_pin_hash : null
    }
  }

  // The household's Code parental, which opens its adults; null hash: none any more.
  setParentalPin(hash: string | null) {
    this.#db
      .prepare(
        'UPDATE accounts SET parental_pin_hash = ?, parental_pin_version = parental_pin_version + 1 WHERE id = ?'
      )
      .run(hash, this.#account)
  }

  // The hash the Code parental is checked against.
  parentalPin() {
    const row = this.#db.prepare('SELECT parental_pin_hash FROM accounts WHERE id = ?').get(this.#account) as
      { parental_pin_hash: string | null } | undefined
    return row?.parental_pin_hash ?? null
  }

  // null hash: no PIN any more.
  setPin(id: number, hash: string | null) {
    if (!this.get(id)) return null
    this.#db.prepare('UPDATE profiles SET pin_hash = ?, pin_version = pin_version + 1 WHERE id = ?').run(hash, id)
    return this.get(id)
  }

  photo(id: number): { data: Buffer; type: PhotoType } | null {
    const row = this.#db
      .prepare('SELECT photo, photo_type FROM profiles WHERE id = ? AND account_id = ? AND photo IS NOT NULL')
      .get(id, this.#account) as { photo: Uint8Array; photo_type: PhotoType } | undefined
    return row ? { data: Buffer.from(row.photo), type: row.photo_type } : null
  }

  // Its state goes with it. The admin stays: the household always has a reader who manages it.
  delete(id: number) {
    const profiles = this.list()
    const profile = profiles.find(candidate => candidate.id === id)
    if (profiles.length <= 1 || !profile || profile.role === 'admin') return false
    this.#db.prepare('DELETE FROM profiles WHERE id = ?').run(id)
    return true
  }
}
