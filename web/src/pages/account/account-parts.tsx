import { ChartColumn, Database, Globe, KeyRound, type LucideIcon, Sparkles, UserRound, Users } from 'lucide-react'
import { type ReactNode, Suspense, lazy, useEffect } from 'react'
import type { AccountView } from '../../api.ts'
import type { AccountPart } from '../../lib/use-hash-route.ts'
import { startUserStateSync } from '../../lib/user-state.ts'
import { AccountProfile, DataPart, DevicePart, SignInPart } from '../../views/settings/sections/AccountSection.tsx'
import RegionCard from '../../views/settings/sections/RegionCard.tsx'
import StatsSkeleton from '../../views/settings/sections/StatsSkeleton.tsx'
import { useTopics } from '../use-home.ts'
import AiPart from './AiPart.tsx'
import ChildrenPart from './ChildrenPart.tsx'

// The chart library loads with the stats only.
const StatsSection = lazy(() => import('../../views/settings/sections/StatsSection.tsx'))

export const PART_ICONS: Record<AccountPart, LucideIcon> = {
  profile: UserRound,
  children: Users,
  'sign-in': KeyRound,
  region: Globe,
  ai: Sparkles,
  stats: ChartColumn,
  data: Database
}

// The sections this account has. A young profile open on another's device: this device and its stats. A teen's or a
// child's own account: its parents run it, so only its stats.
export const partsOf = (account: AccountView | null): AccountPart[] => {
  if (account === null) return ['sign-in', 'stats']
  if (account.young) return ['stats']
  return ['profile', 'children', 'sign-in', 'region', 'ai', 'stats', 'data']
}

// A profile's own statistics, read from every device, as the feed reads them.
const ProfileStats = ({ onUnauthorized }: { onUnauthorized: () => void }) => {
  useEffect(() => startUserStateSync(), [])
  const { allTopics } = useTopics(onUnauthorized)
  return (
    <Suspense fallback={<StatsSkeleton />}>
      <StatsSection topics={allTopics ?? []} />
    </Suspense>
  )
}

interface PartBodyProps {
  part: AccountPart
  account: AccountView | null
  onAccount: (account: AccountView) => void
  layout: 'desktop' | 'phone'
  onUnauthorized: () => void
}

export const PartBody = ({ part, account, onAccount, layout, onUnauthorized }: PartBodyProps): ReactNode => {
  if (part === 'stats') return <ProfileStats onUnauthorized={onUnauthorized} />
  if (account === null) return <DevicePart />
  switch (part) {
    case 'children':
      return <ChildrenPart account={account} onAccount={onAccount} />
    case 'profile':
      return <AccountProfile account={account} onAccount={onAccount} />
    case 'sign-in':
      return <SignInPart account={account} onAccount={onAccount} layout={layout} />
    case 'region':
      return <RegionCard account={account} onAccount={onAccount} />
    case 'ai':
      return <AiPart account={account} onAccount={onAccount} onUnauthorized={onUnauthorized} />
    default:
      return <DataPart account={account} />
  }
}

// The intro under a section's title.
export const introKeyOf = (part: AccountPart, account: AccountView | null) => {
  if (account === null && part === 'sign-in') return 'settings.account.deviceIntro' as const
  if (part === 'stats') return 'stats.intro' as const
  return `accountPage.intros.${part}` as const
}
