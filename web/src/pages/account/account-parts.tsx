import { ChartColumn, Database, Globe, KeyRound, type LucideIcon, UserRound } from 'lucide-react'
import { type ReactNode, Suspense, lazy, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { AccountView } from '../../api.ts'
import type { AccountPart } from '../../lib/use-hash-route.ts'
import { startUserStateSync } from '../../lib/user-state.ts'
import {
  AccountProfile,
  AccountStatsCard,
  DataPart,
  DevicePart,
  SignInPart
} from '../../views/settings/sections/AccountSection.tsx'
import RegionCard from '../../views/settings/sections/RegionCard.tsx'
import StatsSkeleton from '../../views/settings/sections/StatsSkeleton.tsx'
import { useTopics } from '../use-home.ts'

// The chart library loads with the stats only.
const StatsSection = lazy(() => import('../../views/settings/sections/StatsSection.tsx'))

export const PART_ICONS: Record<AccountPart, LucideIcon> = {
  profile: UserRound,
  'sign-in': KeyRound,
  region: Globe,
  stats: ChartColumn,
  data: Database
}

// The sections this account has. A young profile has no account: this device and its stats. An account in no
// household has no profile to show.
export const partsOf = (account: AccountView | null, inHousehold: boolean): AccountPart[] => {
  if (account === null) return ['sign-in', 'stats']
  return inHousehold ? ['profile', 'sign-in', 'region', 'stats', 'data'] : ['sign-in', 'region', 'stats', 'data']
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

// The stats of an account in no household: its totals, kept from every household it read in.
const AccountStats = ({ account }: { account: AccountView }) => {
  const { t } = useTranslation()
  if (!account.stats) return <p>{t('accountPage.noStats')}</p>
  return <AccountStatsCard stats={account.stats} />
}

interface PartBodyProps {
  part: AccountPart
  account: AccountView | null
  onAccount: (account: AccountView) => void
  inHousehold: boolean
  layout: 'desktop' | 'phone'
  onUnauthorized: () => void
}

export const PartBody = ({
  part,
  account,
  onAccount,
  inHousehold,
  layout,
  onUnauthorized
}: PartBodyProps): ReactNode => {
  if (part === 'stats') {
    if (inHousehold) return <ProfileStats onUnauthorized={onUnauthorized} />
    return account && <AccountStats account={account} />
  }
  if (account === null) return <DevicePart />
  switch (part) {
    case 'profile':
      return <AccountProfile />
    case 'sign-in':
      return <SignInPart account={account} onAccount={onAccount} layout={layout} />
    case 'region':
      return <RegionCard account={account} onAccount={onAccount} />
    default:
      return <DataPart account={account} />
  }
}

// The intro under a section's title.
export const introKeyOf = (part: AccountPart, account: AccountView | null, inHousehold: boolean) => {
  if (account === null && part === 'sign-in') return 'settings.account.deviceIntro' as const
  if (part === 'stats') return inHousehold ? ('stats.intro' as const) : ('stats.account.intro' as const)
  return `accountPage.intros.${part}` as const
}
