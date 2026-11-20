import { NO_PASSWORD } from '../auth/password.ts'
import { type Database, transaction } from './database.ts'
import { recordForget, rowKey } from './forget-log.ts'
import { HandleStore } from './handle-store.ts'
import { ParentInvitationStore } from './parent-invitation-store.ts'
import type { ProfileAvatar, ProfileColor, ProfileKind, ProfileStore } from './profile-store.ts'

export type YoungKind = Exclude<ProfileKind, 'adult'>

// Teens' and children's accounts: made by a parent, with no e-mail (they sign in with their @identifier), and run
// by their parents (their sources, hours, password and deletion).

export interface YoungAccount {
  accountId: number
  profileId: number
  name: string
  color: ProfileColor
  kind: YoungKind
  avatar: ProfileAvatar | null
  photoVersion: number | null
  handle: string | null
  // false until a parent gives it one: it then opens only on a device where a parent is signed in.
  hasPassword: boolean
  // Its parents' names, the one asking included.
  parents: string[]
  // The @identifier of the adult invited to be its parent too, while it has not answered.
  invited: string | null
}

interface YoungRow {
  account_id: number
  profile_id: number
  name: string
  color: ProfileColor
  kind: YoungKind
  avatar: ProfileAvatar | null
  photo_version: number | null
  handle: string | null
  has_password: number
  password_hash: string
  parents: string | null
  invited: string | null
}

export interface NewYoungAccount {
  name: string
  color: ProfileColor
  kind: YoungKind
  avatar?: ProfileAvatar
  handle?: string | null
  // Hashed already; absent: none yet.
  passwordHash?: string
}

const SELECT_YOUNG = `
  SELECT u.id AS account_id, p.id AS profile_id, p.name, p.color, p.kind, p.avatar,
    CASE WHEN p.photo IS NULL THEN NULL ELSE p.photo_version END AS photo_version, u.handle, u.has_password,
    u.password_hash,
    (SELECT group_concat(pp.name, char(31)) FROM account_parents ap
      JOIN profiles pp ON pp.user_id = ap.parent_id WHERE ap.child_id = u.id ORDER BY ap.created_at) AS parents,
    (SELECT iu.handle FROM parent_invitations pi JOIN users iu ON iu.id = pi.to_id WHERE pi.child_id = u.id) AS invited
  FROM users u JOIN profiles p ON p.user_id = u.id`

const toYoung = (row: YoungRow): YoungAccount => ({
  accountId: row.account_id,
  profileId: row.profile_id,
  name: row.name,
  color: row.color,
  kind: row.kind,
  avatar: row.avatar,
  photoVersion: row.photo_version,
  handle: row.handle,
  hasPassword: row.has_password === 1 && row.password_hash !== NO_PASSWORD,
  parents: row.parents ? row.parents.split('\u001f') : [],
  invited: row.invited
})

export class YoungAccountStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  get invitations() {
    return new ParentInvitationStore(this.#db)
  }

  // The parent's teens and children, the oldest first.
  childrenOf(parentId: number): YoungAccount[] {
    const rows = this.#db
      .prepare(
        `${SELECT_YOUNG} JOIN account_parents mine ON mine.child_id = u.id AND mine.parent_id = ? ORDER BY p.created_at, p.id`
      )
      .all(parentId) as unknown as YoungRow[]
    return rows.map(toYoung)
  }

  // One of the parent's, or null.
  childOf(parentId: number, accountId: number): YoungAccount | null {
    return this.childrenOf(parentId).find(child => child.accountId === accountId) ?? null
  }

  isParent(parentId: number, childId: number) {
    return (
      this.#db.prepare('SELECT 1 FROM account_parents WHERE parent_id = ? AND child_id = ?').get(parentId, childId) !==
      undefined
    )
  }

  // Whether the account is a teen's or a child's.
  isYoung(accountId: number) {
    return (
      this.#db.prepare("SELECT 1 FROM profiles WHERE user_id = ? AND kind IN ('teen', 'child')").get(accountId) !==
      undefined
    )
  }

  // « Créer un compte », from Mon compte › Mes enfants: its profile in the parent's space, its account, and the parent
  // as its first parent. null when the space is full.
  create(profiles: ProfileStore, parentId: number, young: NewYoungAccount, now: number): YoungAccount | null {
    // ProfileStore makes its profile in a transaction of its own: SQLite does not nest them.
    const profile = profiles.create(young.name, young.color, now, { kind: young.kind, avatar: young.avatar })
    if (!profile) return null
    transaction(this.#db, () => this.#adopt(profile.id, [parentId], now, young))
    return this.childOf(parentId, this.#accountOfProfile(profile.id))
  }

  // A young profile made the way it was before (« Ajouter un profil »): it gets its account, with no password yet.
  adopt(profileId: number, parentIds: number[], now: number) {
    transaction(this.#db, () => this.#adopt(profileId, parentIds, now, {}))
  }

  #adopt(profileId: number, parentIds: number[], now: number, young: Pick<NewYoungAccount, 'handle' | 'passwordHash'>) {
    const hash = young.passwordHash ?? NO_PASSWORD
    const { lastInsertRowid } = this.#db
      .prepare(
        'INSERT INTO users (email, password_hash, password_changed_at, has_password, created_at) VALUES (NULL, ?, ?, ?, ?)'
      )
      .run(hash, now, hash === NO_PASSWORD ? 0 : 1, now)
    const accountId = Number(lastInsertRowid)
    this.#db.prepare('UPDATE profiles SET user_id = ? WHERE id = ?').run(accountId, profileId)
    const name = (this.#db.prepare('SELECT name FROM profiles WHERE id = ?').get(profileId) as { name: string }).name
    new HandleStore(this.#db).assign(accountId, name, now, young.handle ?? null)
    const link = this.#db.prepare(
      'INSERT OR IGNORE INTO account_parents (child_id, parent_id, created_at) VALUES (?, ?, ?)'
    )
    for (const parentId of parentIds) link.run(accountId, parentId, now)
  }

  // A parent's « Supprimer »: its profile, then its account, each written down first so that a backup restored later
  // deletes them again (forget-log.ts). What it read goes with them.
  delete(profiles: ProfileStore, child: Pick<YoungAccount, 'accountId' | 'profileId'>) {
    transaction(this.#db, () => {
      profiles.delete(child.profileId)
      const key = rowKey(this.#db, 'users', child.accountId)
      if (key) recordForget({ kind: 'account', ...key })
      this.#db.prepare('DELETE FROM users WHERE id = ?').run(child.accountId)
    })
  }

  #accountOfProfile(profileId: number) {
    return (this.#db.prepare('SELECT user_id FROM profiles WHERE id = ?').get(profileId) as { user_id: number }).user_id
  }
}
