import type { Database } from './database.ts'
import { accountOwner } from './stats-owner.ts'

// An account's reading stats and points (stats-owner.ts): its copy (« Télécharger une copie ») carries them as they are.
export const accountStatRowsOf = (db: Database, accountId: number) => ({
  readings: db.prepare('SELECT * FROM readings WHERE owner = ?').all(accountOwner(accountId)),
  gameEvents: db.prepare('SELECT * FROM game_events WHERE owner = ?').all(accountOwner(accountId))
})
