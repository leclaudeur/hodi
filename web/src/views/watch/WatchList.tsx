import { AlertCircle, ArrowDown, CirclePlay, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { groupByDay } from '../../lib/day-groups.ts'
import PageHelp from '../../ui/PageHelp.tsx'
import HelpButton from '../../ui/HelpButton.tsx'
import { type ReactNode, useState } from 'react'
import type { ListenFeed } from '../../api.ts'
import { dayOfItem } from '../../lib/format.ts'
import { asSaved, refreshListen, useListen } from '../../lib/listen.ts'
import { type Preferences, isHidden, usePreferences } from '../../lib/preferences.ts'
import { useReadState } from '../../lib/read-state.ts'
import { FRONT_PAGE_HREF } from '../../lib/use-hash-route.ts'
import Button from '../../ui/Button.tsx'
import EmptyState from '../../ui/EmptyState.tsx'
import FilterChip from '../../ui/FilterChip.tsx'
import { ListSkeleton } from '../../ui/Skeleton.tsx'
import TopicCapsule from '../../ui/TopicCapsule.tsx'
import ArticleList, { type DayGroup } from '../ArticleList.tsx'
import ListColumn from '../ListColumn.tsx'
import MobilePage from '../MobilePage.tsx'
import styles from './WatchList.module.css'
import { WEEK_MS } from '../../../../shared/time.ts'

// Kept for the visit: back from a video, the list is as it was left.
let lastFilter: string | null = null
let lastWeeks = 1

// Every section's items once (a channel can be in two), newest first, under their day, for the weeks shown.
// Muted subjects, hidden channels and watched videos go as articles do.
const groupsOf = (feed: ListenFeed, filter: string | null, weeks: number, now: number, preferences: Preferences) => {
  const seen = new Set<string>()
  const items = feed.sections
    .filter(section => filter === null || section.id === filter)
    .flatMap(section => section.items)
    .filter(item => !seen.has(item.id) && seen.add(item.id) && !isHidden(item, preferences))
    .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))

  const since = new Date(now - weeks * WEEK_MS).toISOString()
  const shown = items.filter(item => item.publishedAt === null || item.publishedAt >= since)
  const groups: DayGroup[] = groupByDay(shown, item => dayOfItem(item.publishedAt, now), asSaved)

  return { groups, more: shown.length < items.length }
}

interface ChipsProps {
  sections: ListenFeed['sections']
  filter: string | null
  isPhone: boolean
  onChoose: (id: string | null) => void
}

// A capsule per section of channels; the chosen one again goes back to all.
const SectionChips = ({ sections, filter, isPhone, onChoose }: ChipsProps) => {
  const { t } = useTranslation()
  return (
    <div className={isPhone ? styles.phone : styles.desktop}>
      <div className={`${styles.filters} no-scrollbar edge-fade`} role="group" aria-label={t('lists.filter')}>
        <FilterChip selected={filter === null} onClick={() => onChoose(null)}>
          {t('feed.allTopics')}
        </FilterChip>
        {sections.map(section => (
          <TopicCapsule
            key={section.id}
            topicId={section.id}
            label={section.label}
            size="filter"
            selected={filter === section.id}
            onClick={() => onChoose(filter === section.id ? null : section.id)}
          />
        ))}
      </div>
    </div>
  )
}

interface ContentProps {
  failed: boolean
  loading: boolean
  // A retry is on its way.
  retrying: boolean
  empty: boolean
  layout: 'desktop' | 'phone'
  children: ReactNode
}

// The list that failed or is on its way, no video, or the list.
const WatchContent = ({ failed, loading, retrying, empty, layout, children }: ContentProps) => {
  const { t } = useTranslation()
  if (failed)
    return (
      <EmptyState
        tone="danger"
        icon={<AlertCircle size={28} />}
        title={t('videos.loadFailed')}
        actions={
          <Button look="primary" onClick={() => void refreshListen()} disabled={retrying} icon={RefreshCw}>
            {t('common.retry')}
          </Button>
        }
      >
        {t('common.serverDown')}
      </EmptyState>
    )
  if (loading) return <ListSkeleton layout={layout} />
  if (empty)
    return (
      <EmptyState icon={<CirclePlay size={28} />} title={t('videos.empty')}>
        {t('videos.emptyText')}
      </EmptyState>
    )
  return children
}

interface WatchListProps {
  layout: 'desktop' | 'phone'
  // The video open beside the list (computer).
  activeId?: string | null
  onUnauthorized: () => void
}

// "Vidéos": the videos and episodes of the followed channels and shows, a week at a time.
const WatchList = ({ layout, activeId = null, onUnauthorized }: WatchListProps) => {
  const { t } = useTranslation()
  const { feed, error, loading } = useListen(onUnauthorized)
  const preferences = usePreferences()
  // An article put away leaves the list at once.
  useReadState()
  const [filter, setFilter] = useState(lastFilter)
  const [weeks, setWeeks] = useState(lastWeeks)
  const [now] = useState(Date.now)
  const isPhone = layout === 'phone'

  const choose = (next: string | null) => {
    lastFilter = next
    setFilter(next)
  }
  const loadMore = () => {
    lastWeeks = weeks + 1
    setWeeks(lastWeeks)
  }

  // Only the sections of channels shown: a profile without channels gets no filter row.
  const sections =
    feed?.sections.filter(section => section.items.some(item => !preferences.hiddenSources.includes(item.sourceId))) ??
    []
  const { groups, more } = feed ? groupsOf(feed, filter, weeks, now, preferences) : { groups: [], more: false }
  // "12 ÉLÉMENTS", as a topic counts its articles.
  const count = groups.reduce((total, group) => total + group.items.length, 0)
  const meta = count > 0 ? t('count.item', { count }) : undefined

  const chips = sections.length > 1 && (
    <SectionChips sections={sections} filter={filter} isPhone={isPhone} onChoose={choose} />
  )

  const content = (
    <WatchContent
      failed={!feed && error}
      loading={!feed}
      retrying={loading}
      empty={groups.length === 0}
      layout={layout}
    >
      <ArticleList groups={groups} layout={layout} activeId={activeId} unit="item" />
    </WatchContent>
  )

  const footer = more && (
    <Button look={isPhone ? 'glass' : 'neutral'} wide={!isPhone} onClick={loadMore} icon={ArrowDown}>
      {t(isPhone ? 'videos.previousWeek' : 'videos.loadPreviousWeek')}
    </Button>
  )

  return isPhone ? (
    <MobilePage
      help={
        <HelpButton id="videos_help" title={t('help.videos.title')} layout="phone">
          <PageHelp page="videos" layout="phone" />
        </HelpButton>
      }
      title={t('nav.watch')}
      meta={meta}
      backHref={FRONT_PAGE_HREF}
      backLabel={t('nav.backToFeed')}
      top={chips}
      footer={footer || undefined}
      busy={!feed && !error}
    >
      {content}
    </MobilePage>
  ) : (
    <ListColumn
      help={
        <HelpButton id="videos_help" title={t('help.videos.title')} layout="desktop">
          <PageHelp page="videos" layout="desktop" />
        </HelpButton>
      }
      title={t('nav.watch')}
      meta={meta}
      pinned={chips}
      footer={footer || undefined}
      busy={!feed && !error}
    >
      {content}
    </ListColumn>
  )
}

export default WatchList
