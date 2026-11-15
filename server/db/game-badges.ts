import type { BadgeId } from '../game/rules.ts'
import type { Database } from './database.ts'

// The topic the globetrotter badge counts.
const WORLD_TOPIC = 'world'
const EARLY_HOUR = 7
const LATE_HOUR = 23

// How far a profile went towards each badge, from what earned it points. topicIds: the themes the all-rounder badge
// asks for, each of them.
export const badgeCounts = (db: Database, profileId: number, topicIds: string[]): Record<BadgeId, number> => {
  const row = db
    .prepare(
      `SELECT
         COUNT(CASE WHEN kind = 'article_read' THEN 1 END) AS articles,
         COUNT(CASE WHEN kind = 'article_read' AND hour < ? THEN 1 END) AS early,
         COUNT(CASE WHEN kind = 'article_read' AND hour >= ? THEN 1 END) AS late,
         COUNT(CASE WHEN kind = 'article_read' AND topic_id = ? THEN 1 END) AS world,
         COUNT(CASE WHEN kind = 'reading_day' THEN 1 END) AS days,
         COUNT(CASE WHEN kind = 'share_sent' THEN 1 END) AS shares,
         COUNT(CASE WHEN kind = 'reaction_received' THEN 1 END) AS reactions,
         COUNT(CASE WHEN kind = 'alert_opened' THEN 1 END) AS alerts,
         COUNT(CASE WHEN kind = 'challenge' THEN 1 END) AS challenges
       FROM game_events WHERE profile_id = ?`
    )
    .get(EARLY_HOUR, LATE_HOUR, WORLD_TOPIC, profileId) as Record<string, number>
  const byTopic = new Map(
    (
      db
        .prepare(
          `SELECT topic_id, COUNT(*) AS read FROM game_events
           WHERE profile_id = ? AND kind = 'article_read' AND topic_id IS NOT NULL GROUP BY topic_id`
        )
        .all(profileId) as { topic_id: string; read: number }[]
    ).map(entry => [entry.topic_id, entry.read])
  )
  return {
    'early-bird': row.early ?? 0,
    'night-owl': row.late ?? 0,
    faithful: row.days ?? 0,
    globetrotter: row.world ?? 0,
    'all-rounder': topicIds.length > 0 ? Math.min(...topicIds.map(id => byTopic.get(id) ?? 0)) : 0,
    postman: row.shares ?? 0,
    'crowd-pleaser': row.reactions ?? 0,
    sleuth: row.alerts ?? 0,
    encyclopedia: row.articles ?? 0,
    'team-player': row.challenges ?? 0
  }
}
