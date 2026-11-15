import { type Database, transaction } from './database.ts'
import { type RowKey, recordForget, resetHousehold, rowKey } from './forget-log.ts'
import { DEFAULT_ACCOUNT_ID, currentHouseholdId } from './household-scope.ts'
import type { Profile, ProfileStore } from './profile-store.ts'
import type { UserAccount, UserAccountStore } from './user-account-store.ts'

// Réglages > Compte et données: a copy of what Hodi keeps of a person, and deleting their account.

// What goes with an account. Its profile, always; the whole household when no other adult signs in with an account
// of their own, since no one could open it any more.
export interface DeletionPlan {
  householdGoes: boolean
  household: string
  // The profiles deleted, the person's own first.
  profiles: Pick<Profile, 'id' | 'name' | 'kind'>[]
  // Who takes over the household's admin and the server's, when the person held them.
  heir: Profile | null
}

export const deletionPlan = (
  account: UserAccount,
  accounts: UserAccountStore,
  profiles: ProfileStore,
  householdName: string,
  householdId = currentHouseholdId()
): DeletionPlan => {
  const own = accounts.profileOf(account.id, householdId)
  const all = profiles.list()
  const others = all.filter(profile => profile.kind === 'adult' && profile.hasAccount && profile.id !== own)
  const householdGoes = others.length === 0
  const going = householdGoes ? all : all.filter(profile => profile.id === own)
  going.sort((a, b) => Number(b.id === own) - Number(a.id === own))
  return {
    householdGoes,
    household: householdName,
    profiles: going.map(({ id, name, kind }) => ({ id, name, kind })),
    heir: householdGoes ? null : (others.find(profile => profile.role === 'admin') ?? others[0]!)
  }
}

// The account and what the plan says goes with it, at once. A household that goes is left as a new install's: its
// first-run screens come back, with one first profile to give the next admin. Answers the ids of the accounts deleted:
// the person's, and with a household that goes, those of its other profiles.
export const deleteAccount = (
  db: Database,
  account: UserAccount,
  plan: DeletionPlan,
  now: number,
  householdId = currentHouseholdId()
): number[] =>
  transaction(db, () => {
    const others = leaveHousehold(db, account, plan, now, householdId)
    forgetAccount(db, account.id)
    return [account.id, ...others]
  })

// The account's row, written down first.
const forgetAccount = (db: Database, accountId: number) => {
  const key = rowKey(db, 'users', accountId)
  if (key) recordForget({ kind: 'account', ...key })
  db.prepare('DELETE FROM users WHERE id = ?').run(accountId)
}

// The whole household goes with the account: the other accounts in it too. Their ids.
const wipeHousehold = (db: Database, account: UserAccount, householdId: number, now: number): number[] => {
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

// What the plan takes in one household, the account itself left: the ids of the other accounts that went with it.
const leaveHousehold = (
  db: Database,
  account: UserAccount,
  plan: DeletionPlan,
  now: number,
  householdId: number
): number[] => {
  // What goes is written down before it commits, outside the database: a backup restored later does it again
  // (forget-log.ts).
  const keyOf = (table: 'profiles' | 'users' | 'accounts', id: number) => rowKey(db, table, id)
  if (plan.householdGoes) return wipeHousehold(db, account, householdId, now)
  const own = plan.profiles[0]
  const heir = plan.heir!
  const heirKey = keyOf('profiles', heir.id)
  if (own) {
    const wasAdmin =
      (db.prepare('SELECT role FROM profiles WHERE id = ?').get(own.id) as { role: string } | undefined)?.role ===
      'admin'
    if (wasAdmin) {
      if (heirKey) recordForget({ kind: 'admin', ...heirKey })
      db.prepare("UPDATE profiles SET role = 'admin' WHERE id = ?").run(heir.id)
    }
    const ownKey = keyOf('profiles', own.id)
    if (ownKey) recordForget({ kind: 'profile', ...ownKey, householdId })
    db.prepare('DELETE FROM profiles WHERE id = ?').run(own.id)
  }
  if (account.serverAdmin) {
    // Keyed on the heir's account: its profile may have had no account yet in an older copy.
    const heirUserId = (
      db.prepare('SELECT user_id AS id FROM profiles WHERE id = ?').get(heir.id) as { id: number | null } | undefined
    )?.id
    const heirUser = heirUserId ? keyOf('users', heirUserId) : null
    if (heirUser) recordForget({ kind: 'serverAdmin', ...heirUser })
    db.prepare('UPDATE users SET server_admin = 1 WHERE id = (SELECT user_id FROM profiles WHERE id = ?)').run(heir.id)
  }
  return []
}

// The households an account reads in, by their ids.
export const householdsOf = (db: Database, accountId: number) =>
  (
    db
      .prepare('SELECT DISTINCT account_id AS id FROM profiles WHERE user_id = ? ORDER BY account_id')
      .all(accountId) as { id: number }[]
  ).map(row => row.id)

// Serveur › Comptes › « Supprimer »: in each household it reads in, what « Supprimer ton compte » would take there
// (its profile, or the whole household with its last adult), then the account. plans: by household, each read in its
// household. Never the server's admin, whose own account goes from Compte et données.
export const deleteAccountFromServer = (
  db: Database,
  account: UserAccount,
  plans: { householdId: number; plan: DeletionPlan }[],
  now: number
): { accounts: number[]; households: number[] } =>
  transaction(db, () => {
    const accounts = [account.id]
    for (const { householdId, plan } of plans) accounts.push(...leaveHousehold(db, account, plan, now, householdId))
    forgetAccount(db, account.id)
    return {
      accounts,
      households: plans.filter(({ plan }) => plan.householdGoes).map(({ householdId }) => householdId)
    }
  })

// Serveur › Foyers › « Supprimer »: the household with its profiles and everything they read and kept, and the
// accounts that read in no other household. The server's admin keeps their account, in no household. The core's own
// household is left as a new install's, a plugin's goes. Answers the ids of the accounts deleted.
export const deleteHousehold = (db: Database, householdId: number, now: number): number[] =>
  transaction(db, () => {
    const keyOf = (table: 'profiles' | 'users' | 'accounts', id: number) => rowKey(db, table, id)
    const household = keyOf('accounts', householdId)
    if (!household) return []
    const accounts = (
      db
        .prepare(
          `SELECT DISTINCT u.id FROM profiles p JOIN users u ON u.id = p.user_id
           WHERE p.account_id = ? AND u.server_admin = 0
             AND NOT EXISTS (SELECT 1 FROM profiles o WHERE o.user_id = u.id AND o.account_id <> p.account_id)`
        )
        .all(householdId) as { id: number }[]
    ).map(row => row.id)
    if (householdId === DEFAULT_ACCOUNT_ID) {
      const profiles = db
        .prepare('SELECT id, created_at AS createdAt FROM profiles WHERE account_id = ?')
        .all(householdId) as unknown as RowKey[]
      recordForget({
        kind: 'householdReset',
        ...household,
        profiles: profiles.map(({ id, createdAt }) => ({ id, createdAt })),
        accounts: accounts.flatMap(id => keyOf('users', id) ?? [])
      })
      for (const id of accounts) db.prepare('DELETE FROM users WHERE id = ?').run(id)
      resetHousehold(db, householdId, now)
      return accounts
    }
    recordForget({ kind: 'household', ...household })
    for (const id of accounts) forgetAccount(db, id)
    db.prepare('DELETE FROM accounts WHERE id = ?').run(householdId)
    return accounts
  })

// The tables of a profile's own state, and the columns a copy leaves out: what only the device or the server needs.
const PROFILE_TABLES: { table: string; where: string; omit?: string[] }[] = [
  { table: 'profile_settings', where: 'profile_id' },
  { table: 'saved_articles', where: 'profile_id' },
  { table: 'read_articles', where: 'profile_id' },
  { table: 'readings', where: 'profile_id' },
  { table: 'shares', where: 'profile_id' },
  { table: 'shares', where: 'from_profile' },
  { table: 'seen_stories', where: 'profile_id' },
  { table: 'game_events', where: 'profile_id' },
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

// "Télécharger une copie": the account, the household as the person sees it, their profile and everything it did.
export const accountCopy = (
  db: Database,
  account: UserAccount,
  profileId: number | null,
  now: number,
  householdId = currentHouseholdId()
) => {
  const household = db
    .prepare(
      'SELECT name, language, country, time_zone AS timeZone, created_at AS createdAt FROM accounts WHERE id = ?'
    )
    .get(householdId)
  const user = db
    .prepare('SELECT email, created_at AS createdAt, password_changed_at AS passwordChangedAt FROM users WHERE id = ?')
    .get(account.id)
  const devices = db
    .prepare(
      'SELECT user_agent AS userAgent, created_at AS createdAt, last_seen_at AS lastSeenAt FROM user_devices WHERE user_id = ?'
    )
    .all(account.id)
  const profiles = db
    .prepare('SELECT id, name, color, kind, role FROM profiles WHERE account_id = ? ORDER BY position, id')
    .all(householdId)
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
               FROM household_sources h JOIN sources s ON s.id = h.source_id WHERE h.added_by = ?`
            )
            .all(profileId),
          ...Object.fromEntries(
            PROFILE_TABLES.map(({ table, where }) => [
              where === 'profile_id' ? table : `${table}_sent`,
              (db.prepare(`SELECT * FROM ${table} WHERE ${where} = ?`).all(profileId) as Record<string, unknown>[]).map(
                parsed
              )
            ])
          )
        }
  return {
    exportedAt: new Date(now).toISOString(),
    account: { ...(user as object), serverAdmin: account.serverAdmin, devices },
    household: { ...(household as object), profiles },
    you: own
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

  householdsOf(accountId: number) {
    return householdsOf(this.#db, accountId)
  }

  deleteFromServer(account: UserAccount, plans: { householdId: number; plan: DeletionPlan }[], now: number) {
    return deleteAccountFromServer(this.#db, account, plans, now)
  }

  deleteHousehold(householdId: number, now: number): number[] {
    return deleteHousehold(this.#db, householdId, now)
  }
}
