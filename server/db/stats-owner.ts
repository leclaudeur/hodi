import type { Database } from './database.ts'

// Whose reading stats and points a row of readings or game_events is (migrations.ts): the account's ('a' and its id)
// for a profile with one, which keeps them in any household; else the profile's own ('p' and its id).
export const ownerOf = (db: Database, profileId: number) => {
  const row = db.prepare('SELECT user_id FROM profiles WHERE id = ?').get(profileId) as
    { user_id: number | null } | undefined
  return row?.user_id == null ? `p${profileId}` : `a${row.user_id}`
}

export const accountOwner = (accountId: number) => `a${accountId}`

// The same, in SQL, for a profiles row under this alias.
export const ownerSql = (alias: string) =>
  `(CASE WHEN ${alias}.user_id IS NULL THEN 'p' || ${alias}.id ELSE 'a' || ${alias}.user_id END)`
