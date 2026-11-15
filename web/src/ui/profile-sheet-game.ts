import type { BadgeId, GameNews, Profile, ProfileGame } from '../api.ts'
import { getLanguage } from '../lib/i18n.ts'

export type SheetProfile = Pick<Profile, 'id' | 'name' | 'color' | 'photoVersion'>

// Each sheet as last loaded: opened again, it shows at once, at its size, and is brought up to date behind.
export const loaded = new Map<number, ProfileGame>()

export const TIERS = ['', 'bronze', 'silver', 'gold'] as const

// What one's own sheet celebrates first, a page each, in the sheet's dialog: the new grade, then each new badge.
export type PartyPage = { kind: 'level' } | { kind: 'badge'; id: BadgeId }

export const pagesOf = (news: GameNews): PartyPage[] => [
  ...(news.level !== null ? [{ kind: 'level' } as const] : []),
  ...news.badges.map(badge => ({ kind: 'badge', id: badge.id }) as const)
]

export const points = (value: number) => value.toLocaleString(getLanguage())
