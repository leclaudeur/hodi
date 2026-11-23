import type { Database } from './database.ts'
import { accountOwner } from './stats-owner.ts'

// Who shares a weekly challenge: a profile's account and its family (its parents, its children, its parents'
// children and its children's other parents), the people Partager offers first. A profile with no account plays alone.
export const teamOf = (db: Database, profileId: number): { owners: string[]; profiles: number[] } => {
  const row = db.prepare('SELECT user_id FROM profiles WHERE id = ?').get(profileId) as
    { user_id: number | null } | undefined
  const accountId = row?.user_id ?? null
  if (accountId === null) return { owners: [`p${profileId}`], profiles: [profileId] }
  const ids = (sql: string, id: number) => (db.prepare(sql).all(id) as { id: number }[]).map(found => found.id)
  const parentsOf = (id: number) => ids('SELECT parent_id AS id FROM account_parents WHERE child_id = ?', id)
  const childrenOf = (id: number) => ids('SELECT child_id AS id FROM account_parents WHERE parent_id = ?', id)
  const parents = parentsOf(accountId)
  const children = childrenOf(accountId)
  const family = new Set([
    accountId,
    ...parents,
    ...children,
    ...parents.flatMap(childrenOf),
    ...children.flatMap(parentsOf)
  ])
  const accounts = JSON.stringify([...family])
  const profiles = db
    .prepare('SELECT id FROM profiles WHERE user_id IN (SELECT value FROM json_each(?)) ORDER BY id')
    .all(accounts) as { id: number }[]
  return { owners: [...family].map(accountOwner), profiles: profiles.map(profile => profile.id) }
}
