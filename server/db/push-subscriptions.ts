import type { AlertSettings } from '../news/followed-alerts.ts'
import type { Database } from './database.ts'

// The devices that asked for alerts, each with the profile it reads as.

export const listPushSubscriptions = (db: Database): AlertSettings[] => {
  const rows = db.prepare('SELECT settings FROM push_subscriptions').all() as { settings: string }[]
  return rows.map(row => JSON.parse(row.settings) as AlertSettings)
}

export const savePushSubscription = (db: Database, profileId: number, settings: AlertSettings, now: number) => {
  db.prepare(
    `INSERT INTO push_subscriptions (endpoint, profile_id, settings, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE SET
       profile_id = excluded.profile_id, settings = excluded.settings, updated_at = excluded.updated_at`
  ).run(settings.target.endpoint, profileId, JSON.stringify(settings), now)
}

export const removePushSubscription = (db: Database, endpoint: string) => {
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint)
}
