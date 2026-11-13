import { Activity, Bookmark, CirclePlay, History, type LucideIcon, Newspaper, Send, Settings } from 'lucide-react'
import { useFollowedUnread } from '../lib/followed-items.ts'
import { useCurrentProfile } from '../lib/profiles.ts'
import { usePendingRequests } from '../lib/requests.ts'
import { useSaved } from '../lib/saved.ts'
import { useSourceAnswers } from '../lib/source-answers.ts'
import { useLastReaction, useSharesUnread, useSharingShown } from '../lib/shares.ts'
import {
  FOLLOWED_HREF,
  FRONT_PAGE_HREF,
  HISTORY_HREF,
  LISTEN_HREF,
  SAVED_HREF,
  SETTINGS_HREF,
  SHARES_HREF
} from '../lib/use-hash-route.ts'

export type Section = 'today' | 'saved' | 'followed' | 'shares' | 'watch' | 'history' | 'settings'

// Its name is nav.<id> in the locale files.
export interface NavLink {
  id: Section
  href: string
  icon: LucideIcon
}

const MAIN_LINKS: NavLink[] = [
  { id: 'today', href: FRONT_PAGE_HREF, icon: Newspaper },
  { id: 'saved', href: SAVED_HREF, icon: Bookmark },
  { id: 'followed', href: FOLLOWED_HREF, icon: Activity },
  { id: 'shares', href: SHARES_HREF, icon: Send },
  { id: 'watch', href: LISTEN_HREF, icon: CirclePlay }
]

// "Partages" only once the household has another profile, and while this one shares.
export const useMainLinks = () => {
  const sharing = useSharingShown()
  return MAIN_LINKS.filter(link => link.id !== 'shares' || sharing)
}

// On a computer only, under the others: a phone's bar has no room left (its way in is Réglages > Lecture).
export const HISTORY_LINK: NavLink = { id: 'history', href: HISTORY_HREF, icon: History }

export const SETTINGS_LINK: NavLink = { id: 'settings', href: SETTINGS_HREF, icon: Settings }

// The counters beside "Enregistrés", "Suivis" and "Partages": saved articles, and the unread ones of the others.
// Nothing sent left to open, "Partages" shows the last emoji received instead. On the settings' wheel, for a
// parent: the teens' requests waiting for an answer; for a teen, its parents' answers it has not seen.
export const useNavCounts = () => {
  const kind = useCurrentProfile()?.kind
  const pending = usePendingRequests(kind === 'adult').length
  const answers = useSourceAnswers(kind === 'teen').length
  return {
    saved: useSaved().length,
    followed: useFollowedUnread(),
    shares: useSharesUnread(),
    reaction: useLastReaction(),
    requests: pending + answers
  }
}

// The counter beside a section: how many are saved, how many followed articles or shares are new, and on the
// settings' wheel, the requests.
export const countOf = (id: Section, counts: ReturnType<typeof useNavCounts>) => {
  if (id === 'saved') return counts.saved
  if (id === 'followed') return counts.followed
  if (id === 'shares') return counts.shares
  if (id === 'settings') return counts.requests
  return 0
}
