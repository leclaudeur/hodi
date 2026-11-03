import { AlertCircle, Send } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import PageHelp from '../ui/PageHelp.tsx'
import HelpButton from '../ui/HelpButton.tsx'
import { useState } from 'react'
import type { TopicItem } from '../api.ts'
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

  const groups: DayGroup[] = []
  for (const entry of shown) {
    const day = dayOfItem(new Date(entry.sharedAt).toISOString())
    const group = groups.at(-1)
    if (group?.day === day) group.items.push(entry.item)
    else groups.push({ day, items: [entry.item] })
  }

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
    <div
      className={`${layout === 'phone' ? rowStyles.row : followedStyles.filters} no-scrollbar edge-fade`}
      role="group"
      aria-label={t('shares.filter')}
    >
      <FilterChip selected={chosen === null} count={count} onClick={() => setSender(null)}>
        {t('feed.allTopics')}
      </FilterChip>
      {senders.map(id => (
        <FilterChip
          key={id}
          selected={chosen === id}
          count={(entries ?? []).filter(entry => entry.from === id).length}
          onClick={() => setSender(chosen === id ? null : id)}
        >
          {profileOf(id)?.name}
        </FilterChip>
      ))}
    </div>
  )
  const content = error ? (
    <EmptyState tone="danger" icon={<AlertCircle size={28} />} title={t('shares.loadFailed')}>
      {t('common.serverDown')}
    </EmptyState>
  ) : entries === null || !household ? (
    <ListSkeleton layout={layout} />
  ) : shown.length === 0 ? (
    <>
      <ShareReactions layout={layout} />
      <EmptyState icon={<Send size={28} />} title={t('shares.empty')}>
        {t('shares.emptyText')}
      </EmptyState>
    </>
  ) : (
    <>
      {layout === 'phone' && filters}
      <ShareReactions layout={layout} from={chosen} />
      <ArticleList groups={groups} layout={layout} activeId={activeId} metaOf={metaOf} />
    </>
  )

  return layout === 'desktop' ? (
    <ListColumn
      help={
        <HelpButton id="shares_help" title={t('help.shares.title')} layout="desktop">
          <PageHelp page="shares" layout="desktop" />
        </HelpButton>
      }
      title={t('nav.shares')}
      meta={meta}
      pinned={filters}
      busy={entries === null}
    >
      {content}
    </ListColumn>
  ) : (
    <MobilePage
      help={
        <HelpButton id="shares_help" title={t('help.shares.title')} layout="phone">
          <PageHelp page="shares" layout="phone" />
        </HelpButton>
      }
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
