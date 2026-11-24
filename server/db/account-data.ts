import { ownerOf } from './stats-owner.ts'
import { type Database, transaction } from './database.ts'
import { recordForget, resetHousehold, rowKey } from './forget-log.ts'
import { DEFAULT_ACCOUNT_ID } from './server-row.ts'
import { accountStatRowsOf } from './account-stats.ts'
import type { Profile, ProfileStore } from './profile-store.ts'
import type { UserAccount, UserAccountStore } from './user-account-store.ts'

// Réglages > Compte et données: a copy of what Hodi keeps of a person, and deleting their account.

// What goes with an account. Its profile, always; every profile when no other adult signs in with an account of
// their own, since no one could open them any more.
export interface DeletionPlan {
  serverGoes: boolean
  // The profiles deleted, the person's own first.
  profiles: Pick<Profile, 'id' | 'name' | 'kind'>[]
  // The account is the server's last admin and other people still have accounts: nobody is made the server's admin
  // without being chosen, so another admin is named in Serveur › Comptes first, and nothing is deleted until then.
  handOverFirst: boolean
  // The teens and children the person is the only parent of: their accounts go too. With the server, they are among
  // its profiles already.
  children: { accountId: number; id: number; name: string }[]
}

export const deletionPlan = (
  account: UserAccount,
  accounts: UserAccountStore,
  profiles: ProfileStore
): DeletionPlan => {
  const own = accounts.profileOf(account.id)
  const all = profiles.everyone()
  const others = all.filter(profile => profile.kind === 'adult' && profile.hasAccount && profile.id !== own)
  // An account with no profile (deleted by an admin) never takes the others with it.
  const serverGoes = others.length === 0 && (own !== null || account.serverAdmin)
  const going = serverGoes ? all : all.filter(profile => profile.id === own)
  going.sort((a, b) => Number(b.id === own) - Number(a.id === own))
  const lastAdmin = account.serverAdmin && accounts.serverAdmins().every(admin => admin.id === account.id)
  return {
    serverGoes,
    handOverFirst: lastAdmin && !serverGoes,
    profiles: going.map(({ id, name, kind }) => ({ id, name, kind })),
    // Its children go with it: no one would run them any more.
    children: serverGoes ? [] : onlyChildren(account, accounts, profiles)
  }
}

const onlyChildren = (account: UserAccount, accounts: UserAccountStore, profiles: ProfileStore) =>
  accounts.young.invitations.onlyChildrenOf(account.id).flatMap(accountId => {
    const id = accounts.profileOf(accountId)
    const profile = id === null ? null : profiles.find(id)
    return profile ? [{ accountId, id: profile.id, name: profile.name }] : []
  })

// The account and what the plan says goes with it, at once. With the last adult, the server is left as a new
// install's: its first-run screens come back, with one first profile to give the next admin. Answers the ids of the
// accounts deleted: the person's, and with the last adult, those of the other profiles.
export const deleteAccount = (db: Database, account: UserAccount, plan: DeletionPlan, now: number): number[] =>
  transaction(db, () => {
    const others = leaveServer(db, account, plan, now)
    forgetAccount(db, account.id)
    return [account.id, ...others]
  })

// The account's row, written down first.
const forgetAccount = (db: Database, accountId: number) => {
  const key = rowKey(db, 'users', accountId)
  if (key) recordForget({ kind: 'account', ...key })
  db.prepare('DELETE FROM users WHERE id = ?').run(accountId)
}

// Everything goes with the last adult's account: the other accounts too. Their ids.
const wipeServer = (db: Database, account: UserAccount, now: number): number[] => {
  const householdId = DEFAULT_ACCOUNT_ID
  const keyOf = (table: 'profiles' | 'users' | 'accounts', id: number) => rowKey(db, table, id)
  const others = (
    db
      .prepare('SELECT DISTINCT user_id AS id FROM profiles WHERE account_id = ? AND user_id IS NOT NULL')
      .all(householdId) as { id: number }[]
  )
    .map(row => row.id)
    .filter(id => id !== account.id)
  const profiles = (
    db.prepare('SELECT id, created_at AS createdAt FROM profiles WHERE account_id = ?').all(householdId) as {
      id: number
      createdAt: number
    }[]
  ).map(({ id, createdAt }) => ({ id, createdAt }))
  const accounts = [account.id, ...others].flatMap(id => keyOf('users', id) ?? [])
  const household = keyOf('accounts', householdId)
  if (household) recordForget({ kind: 'householdReset', ...household, profiles, accounts })
  for (const id of others) db.prepare('DELETE FROM users WHERE id = ?').run(id)
  resetHousehold(db, householdId, now)
  return others
}

// What the plan takes, the account itself left: the ids of the other accounts that went with it.
const leaveServer = (db: Database, account: UserAccount, plan: DeletionPlan, now: number): number[] => {
  // What goes is written down before it commits, outside the database: a backup restored later does it again
  // (forget-log.ts).
  if (plan.serverGoes) return wipeServer(db, account, now)
  const children = forgetChildren(db, plan)
  const own = plan.profiles[0]
  if (own) {
    const ownKey = rowKey(db, 'profiles', own.id)
    if (ownKey) recordForget({ kind: 'profile', ...ownKey, householdId: DEFAULT_ACCOUNT_ID })
    db.prepare('DELETE FROM profiles WHERE id = ?').run(own.id)
  }
  return children
}

// The young accounts left with no parent: their profiles and accounts, each written down first.
const forgetChildren = (db: Database, plan: DeletionPlan) =>
  plan.children.map(child => {
    const key = rowKey(db, 'profiles', child.id)
    if (key) recordForget({ kind: 'profile', ...key, householdId: DEFAULT_ACCOUNT_ID })
    db.prepare('DELETE FROM profiles WHERE id = ?').run(child.id)
    forgetAccount(db, child.accountId)
    return child.accountId
  })

// Serveur › Comptes › « Supprimer »: what « Supprimer ton compte » would take (its profile, or everything with the
// last adult), then the account. Never the server's admin, whose own account goes from Compte et données.
export const deleteAccountFromServer = (
  db: Database,
  account: UserAccount,
  plan: DeletionPlan,
  now: number
): number[] =>
  transaction(db, () => {
    const others = leaveServer(db, account, plan, now)
    forgetAccount(db, account.id)
    return [account.id, ...others]
  })

// The tables of a profile's own state, and the columns a copy leaves out: what only the device or the server needs.
// Those by owner are the account's (or a young profile's) in any household (stats-owner.ts).
const PROFILE_TABLES: { table: string; where: string; omit?: string[] }[] = [
  { table: 'profile_settings', where: 'owner' },
  { table: 'saved_articles', where: 'owner' },
  { table: 'read_articles', where: 'owner' },
  { table: 'shares', where: 'profile_id' },
  { table: 'shares', where: 'from_profile' },
  { table: 'seen_stories', where: 'owner' },
  { table: 'daily_summaries', where: 'profile_id' },
  { table: 'ai_calls', where: 'profile_id' }
]

// JSON kept as text in the database comes out as JSON.
const parsed = (row: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => {
      if (typeof value === 'string' && /^[[{]/.test(value)) {
        try {
          return [key, JSON.parse(value) as unknown]
        } catch {
          return [key, value]
        }
      }
      return [key, value]
    })
  )

// "Télécharger une copie": the account, its profile and its children's, and everything its profile did.
export const accountCopy = (db: Database, account: UserAccount, profileId: number | null, now: number) => {
  const user = db
    .prepare('SELECT email, created_at AS createdAt, password_changed_at AS passwordChangedAt FROM users WHERE id = ?')
    .get(account.id)
  const devices = db
    .prepare(
      'SELECT user_agent AS userAgent, created_at AS createdAt, last_seen_at AS lastSeenAt FROM user_devices WHERE user_id = ?'
    )
    .all(account.id)
  const profiles = db
    .prepare(
      `SELECT id, name, color, kind, role FROM profiles
       WHERE user_id = ? OR user_id IN (SELECT child_id FROM account_parents WHERE parent_id = ?) ORDER BY position, id`
    )
    .all(account.id, account.id)
  const own =
    profileId === null
      ? null
      : {
          profile: db
            .prepare('SELECT id, name, color, kind, role, created_at AS createdAt FROM profiles WHERE id = ?')
            .get(profileId),
          sources: db
            .prepare(
              `SELECT s.id, s.name, s.url, s.kind, s.lang, h.created_at AS createdAt
               FROM catalog_sources h JOIN sources s ON s.id = h.source_id WHERE h.added_by = ?`
            )
            .all(profileId),
          ...Object.fromEntries(
            PROFILE_TABLES.map(({ table, where }) => [
              where === 'from_profile' ? `${table}_sent` : table,
              (
                db
                  .prepare(`SELECT * FROM ${table} WHERE ${where} = ?`)
                  .all(where === 'owner' ? ownerOf(db, profileId) : profileId) as Record<string, unknown>[]
              ).map(parsed)
            ])
          )
        }
  return {
    exportedAt: new Date(now).toISOString(),
    account: { ...(user as object), serverAdmin: account.serverAdmin, devices },
    profiles,
    you: own,
    // What it read and earned, its own in any household: its readings and the game's points.
    stats: accountStatRowsOf(db, account.id)
  }
}

// The two above for the routes, which hold no database of their own.
export class AccountDataStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  copy(account: UserAccount, profileId: number | null, now: number) {
    return accountCopy(this.#db, account, profileId, now)
  }

  delete(account: UserAccount, plan: DeletionPlan, now: number): number[] {
    return deleteAccount(this.#db, account, plan, now)
  }

  deleteFromServer(account: UserAccount, plan: DeletionPlan, now: number) {
    return deleteAccountFromServer(this.#db, account, plan, now)
  }
}
