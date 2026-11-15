import { AlertCircle, Send } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { groupByDay } from '../lib/day-groups.ts'
import PageHelp from '../ui/PageHelp.tsx'
import HelpButton from '../ui/HelpButton.tsx'
import { type ReactNode, useState } from 'react'
import type { ShareEntry, TopicItem } from '../api.ts'
import { dayOfItem, shortAgo } from '../lib/format.ts'
import { usePreferences } from '../lib/preferences.ts'
import { useProfiles } from '../lib/profiles.ts'
import { isDismissed, isReadAndClosed, useReadState } from '../lib/read-state.ts'
import { useShares } from '../lib/shares.ts'
import { FRONT_PAGE_HREF } from '../lib/use-hash-route.ts'
import EmptyState from '../ui/EmptyState.tsx'
import FilterChip from '../ui/FilterChip.tsx'
import ProfileAvatar from '../ui/ProfileAvatar.tsx'
import { ListSkeleton } from '../ui/Skeleton.tsx'
import ArticleList, { type DayGroup } from './ArticleList.tsx'
import followedStyles from './FollowedScreen.module.css'
import ListColumn from './ListColumn.tsx'
import rowStyles from './MobileFilterRow.module.css'
import MobilePage from './MobilePage.tsx'
import ShareReactions from './ShareReactions.tsx'
import styles from './SharesScreen.module.css'

interface SharesScreenProps {
  layout: 'desktop' | 'phone'
  activeId?: string | null
  onUnauthorized: () => void
}

const SharesHelp = ({ layout }: { layout: 'desktop' | 'phone' }) => {
  const { t } = useTranslation()
  return (
    <HelpButton id="shares_help" title={t('help.shares.title')} layout={layout}>
      <PageHelp page="shares" layout={layout} />
    </HelpButton>
  )
}

interface FiltersProps {
  senders: number[]
  entries: ShareEntry[]
  chosen: number | null
  layout: 'desktop' | 'phone'
  nameOf: (id: number) => string | undefined
  onChoose: (id: number | null) => void
}

// A capsule per profile that sent something, as Suivis' subjects; the chosen one again goes back to all.
const SenderFilters = ({ senders, entries, chosen, layout, nameOf, onChoose }: FiltersProps) => {
  const { t } = useTranslation()
  return (
    <div
      className={`${layout === 'phone' ? rowStyles.row : followedStyles.filters} no-scrollbar edge-fade`}
      role="group"
      aria-label={t('shares.filter')}
    >
      <FilterChip selected={chosen === null} count={entries.length} onClick={() => onChoose(null)}>
        {t('feed.allTopics')}
      </FilterChip>
      {senders.map(id => (
        <FilterChip
          key={id}
          selected={chosen === id}
          count={entries.filter(entry => entry.from === id).length}
          onClick={() => onChoose(chosen === id ? null : id)}
        >
          {nameOf(id)}
        </FilterChip>
      ))}
    </div>
  )
}

interface ContentProps {
  error: boolean
  loading: boolean
  empty: boolean
  layout: 'desktop' | 'phone'
  children: ReactNode
}

// The list that failed or is on its way, the reactions over an empty list, or the list.
const SharesContent = ({ error, loading, empty, layout, children }: ContentProps) => {
  const { t } = useTranslation()
  if (error)
    return (
      <EmptyState tone="danger" icon={<AlertCircle size={28} />} title={t('shares.loadFailed')}>
        {t('common.serverDown')}
      </EmptyState>
    )
  if (loading) return <ListSkeleton layout={layout} />
  if (!empty) return children
  return (
    <>
      <ShareReactions layout={layout} />
      <EmptyState icon={<Send size={28} />} title={t('shares.empty')}>
        {t('shares.emptyText')}
      </EmptyState>
    </>
  )
}

// "Partages": what the household's other profiles sent here this week, newest first, under the day it was sent.
// The fil's cards, with who sent it and when in place of the source. As in Suivis, an article read (once closed,
// unless "Masquer les articles lus" is off) or put away goes.
const SharesScreen = ({ layout, activeId = null, onUnauthorized }: SharesScreenProps) => {
  const { t } = useTranslation()
  const { entries: all, error } = useShares(onUnauthorized)
  const { hideRead } = usePreferences()
  useReadState()
  const entries =
    all?.filter(entry => !isDismissed(entry.item.id) && !(hideRead && isReadAndClosed(entry.item.id))) ?? null
  const household = useProfiles({ onError: () => {} })
  const [sender, setSender] = useState<number | null>(null)
  const profileOf = (id: number) => household?.profiles.find(profile => profile.id === id)
  const senders = [...new Set((entries ?? []).map(entry => entry.from))].filter(id => profileOf(id))
  const chosen = sender !== null && senders.includes(sender) ? sender : null
  const shown = (entries ?? []).filter(entry => chosen === null || entry.from === chosen)
  const entryOf = new Map(shown.map(entry => [entry.item.id, entry]))

  const groups: DayGroup[] = groupByDay(
    shown,
    entry => dayOfItem(new Date(entry.sharedAt).toISOString()),
    entry => entry.item
  )

  const metaOf = (item: TopicItem) => {
    const entry = entryOf.get(item.id)
    const from = entry && profileOf(entry.from)
    if (!entry || !from) return {}
    return {
      byline: (
        <>
          <ProfileAvatar profile={from} size={20} />
          <span className={styles.name}>{from.name}</span>
        </>
      ),
      note: shortAgo(new Date(entry.sharedAt).toISOString()),
      quote: entry.note
    }
  }

  const count = entries?.length ?? 0
  const meta = count > 0 ? t('count.article', { count }) : undefined
  // As Suivis: held under the header on a computer, above the list on a phone.
  const filters = senders.length > 1 && (
    <SenderFilters
      senders={senders}
      entries={entries ?? []}
      chosen={chosen}
      layout={layout}
      nameOf={id => profileOf(id)?.name}
      onChoose={setSender}
    />
  )
  const content = (
    <SharesContent error={error} loading={entries === null || !household} empty={shown.length === 0} layout={layout}>
      {layout === 'phone' && filters}
      <ShareReactions layout={layout} from={chosen} />
      <ArticleList groups={groups} layout={layout} activeId={activeId} metaOf={metaOf} />
    </SharesContent>
  )

  return layout === 'desktop' ? (
    <ListColumn
      help={<SharesHelp layout="desktop" />}
      title={t('nav.shares')}
      meta={meta}
      pinned={filters}
      busy={entries === null}
    >
      {content}
    </ListColumn>
  ) : (
    <MobilePage
      help={<SharesHelp layout="phone" />}
      title={t('nav.shares')}
      meta={meta}
      backHref={FRONT_PAGE_HREF}
      backLabel={t('nav.backToFeed')}
      busy={entries === null}
    >
      {content}
    </MobilePage>
  )
}

export default SharesScreen
