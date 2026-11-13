import { getJson, sendJson } from './http.ts'

// The household game (gamification.yml): levels, badges, the week's challenge and ranking.
export type BadgeId =
  | 'early-bird'
  | 'night-owl'
  | 'faithful'
  | 'globetrotter'
  | 'all-rounder'
  | 'postman'
  | 'crowd-pleaser'
  | 'sleuth'
  | 'encyclopedia'
  | 'team-player'

// 0: not earned yet, then bronze, silver, gold.
export type BadgeTier = 0 | 1 | 2 | 3

export interface BadgeProgress {
  id: BadgeId
  name: string
  count: number
  tier: BadgeTier
  // What the next tier needs, or null once gold.
  next: number | null
  // What each tier needs: bronze, silver, gold.
  tiers: number[]
}

export interface WornBadge {
  id: BadgeId
  tier: BadgeTier
}

export interface GameLevel {
  // From 1.
  level: number
  name: string
  points: number
  // Where this level starts: its bar counts from there.
  since: number
  // The grade before, or null at the first.
  previous: { name: string } | null
  next: { name: string; points: number } | null
  // 0 to 1 of the way to the next level.
  progress: number
  // Earned since Monday.
  week: number
}

// Earned since one's own sheet was last opened: celebrated there once.
export interface GameNews {
  // The level reached, or null when it did not change.
  level: number | null
  badges: WornBadge[]
  // When the sheet was last opened, only with news.
  since?: number
}

export interface ProfileGame extends GameLevel {
  badges: BadgeProgress[]
  badge: WornBadge | null
  // One's own sheet only.
  news?: GameNews
}

export interface RankingEntry {
  profileId: number
  week: number
  level: number
  name: string
  progress: number
  badge: WornBadge | null
}

export interface HouseholdGame {
  enabled: boolean
  challenge: { goal: number; read: number; reached: boolean }
  // Most points this week first.
  ranking: RankingEntry[]
  // The profile asking: what its avatar shows as new.
  news: GameNews
}

export const getHouseholdGame = () => getJson<HouseholdGame>('/game')

// Every badge, earned or not, with its progress.
export const getMyGame = () => getJson<ProfileGame>('/me/game')

// Another profile's: only the badges it earned.
export const getProfileGame = (id: number) => getJson<ProfileGame>(`/game/profiles/${id}`)

export const wearBadge = (badge: BadgeId | null) =>
  sendJson<{ badge: BadgeId | null }>('PUT', '/me/game/badge', { badge })

// One's own sheet showed what was new.
export const markGameSeen = () => sendJson('POST', '/me/game/seen')

export const setGameEnabled = (enabled: boolean) => sendJson('PUT', '/game/enabled', { enabled })
