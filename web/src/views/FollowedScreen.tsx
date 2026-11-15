import { Activity, AlertCircle, ArrowDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import PageHelp from '../ui/PageHelp.tsx'
import HelpButton from '../ui/HelpButton.tsx'
import { type ReactNode, useEffect, useState } from 'react'
import type { TopicItem } from '../api.ts'
import { groupByDay } from '../lib/day-groups.ts'
import { useFollowedItems } from '../lib/followed-items.ts'
import { dayOfItem, loadDayLabel } from '../lib/format.ts'
import { markFollowedSeen } from '../lib/notifications.ts'
import { followedWordsOf, usePreferences } from '../lib/preferences.ts'
import { FRONT_PAGE_HREF, SETTINGS_HREF } from '../lib/use-hash-route.ts'
import Button from '../ui/Button.tsx'
import EmptyState from '../ui/EmptyState.tsx'
import FilterChip from '../ui/FilterChip.tsx'
import { ListSkeleton } from '../ui/Skeleton.tsx'
import ArticleList, { type DayGroup } from './ArticleList.tsx'
import styles from './FollowedScreen.module.css'
import ListColumn from './ListColumn.tsx'
import rowStyles from './MobileFilterRow.module.css'
import MobilePage from './MobilePage.tsx'
import { revealDay } from './use-feed-view.ts'

interface FollowedScreenProps {
  layout: 'desktop' | 'phone'
  activeId?: string | null
  onUnauthorized: () => void
}

// As Le fil: the latest day first, "Charger <jour>" for each one before. The counts follow the days shown.
const useShownDays = (items: TopicItem[] | null) => {
  const [dayCount, setDayCount] = useState(1)
  const days = [...new Set((items ?? []).map(item => dayOfItem(item.publishedAt)))]
  const daysShown = new Set(days.slice(0, dayCount))
  return {
    inDays: items?.filter(item => daysShown.has(dayOfItem(item.publishedAt))) ?? null,
    nextDay: days[dayCount] ?? null,
    showNextDay: () => setDayCount(count => count + 1)
  }
}

const FollowedHelp = ({ layout }: { layout: 'desktop' | 'phone' }) => {
  const { t } = useTranslation()
  return (
    <HelpButton id="followed_help" title={t('help.followed.title')} layout={layout}>
      <PageHelp page="followed" layout={layout} />
    </HelpButton>
  )
}

interface FiltersProps {
  words: string[]
  inDays: TopicItem[]
  chosen: string | null
  className: string | undefined
  subjectsOf: (item: TopicItem) => string[]
  onChoose: (word: string | null) => void
}

// A capsule per subject followed, with its count in the days shown; the chosen one again goes back to all.
const SubjectFilters = ({ words, inDays, chosen, className, subjectsOf, onChoose }: FiltersProps) => {
  const { t } = useTranslation()
  return (
    <div className={`${className} no-scrollbar edge-fade`} role="group" aria-label={t('followed.filter')}>
      <FilterChip selected={chosen === null} count={inDays.length} onClick={() => onChoose(null)}>
        {t('feed.allTopics')}
      </FilterChip>
      {words.map(word => {
        const count = inDays.filter(item => subjectsOf(item).includes(word)).length
        return (
          <FilterChip
            key={word}
            selected={chosen === word}
            count={count}
            disabled={count === 0}
            onClick={() => onChoose(chosen === word ? null : word)}
          >
            {word}
          </FilterChip>
        )
      })}
    </div>
  )
}

interface ContentProps {
  words: string[]
  error: boolean
  loading: boolean
  empty: boolean
  layout: 'desktop' | 'phone'
  children: ReactNode
}

// No subject followed, the list that failed or is on its way, nothing new, or the articles.
const FollowedContent = ({ words, error, loading, empty, layout, children }: ContentProps) => {
  const { t } = useTranslation()
  if (words.length === 0)
    return (
      <EmptyState
        icon={<Activity size={28} />}
        title={t('followed.none')}
        actions={<Button onClick={() => (window.location.hash = SETTINGS_HREF)}>{t('followed.add')}</Button>}
      >
        {t('followed.noneText')}
      </EmptyState>
    )
  if (error)
    return (
      <EmptyState tone="danger" icon={<AlertCircle size={28} />} title={t('followed.loadFailed')}>
        {t('common.serverDown')}
      </EmptyState>
    )
  if (loading) return <ListSkeleton layout={layout} />
  if (empty)
    return (
      <EmptyState icon={<Activity size={28} />} title={t('feed.nothingNew')}>
        {t('followed.nothingNew')}
      </EmptyState>
    )
  return children
}

// "Suivis": the articles of every topic about the subjects followed in the settings, newest first.
const FollowedScreen = ({ layout, activeId = null, onUnauthorized }: FollowedScreenProps) => {
  const { t } = useTranslation()
  const { words, items, error } = useFollowedItems(onUnauthorized)
  const preferences = usePreferences()
  // One subject at a time, or all of them. An article about two subjects is under both.
  const [subject, setSubject] = useState<string | null>(null)
  const chosen = subject !== null && words.includes(subject) ? subject : null
  const subjectsOf = (item: NonNullable<typeof items>[number]) => followedWordsOf(item, preferences)
  // On a phone, the home page's row of capsules, dividers included; on a computer, the search's.
  const rowClass = layout === 'phone' ? rowStyles.row : styles.filters
  const { inDays, nextDay, showNextDay } = useShownDays(items)
  const shown = chosen === null ? inDays : (inDays?.filter(item => subjectsOf(item).includes(chosen)) ?? null)

  // Opening the list clears the count on the app icon.
  useEffect(() => {
    void markFollowedSeen()
  }, [])

  const groups: DayGroup[] = groupByDay(
    shown ?? [],
    item => dayOfItem(item.publishedAt),
    item => item
  )

  const meta =
    inDays && inDays.length > 0
      ? `${t('count.article', { count: inDays.length })} · ${t('count.subject', { count: words.length })}`
      : undefined
  const footer = nextDay && !error && (
    <Button
      look={layout === 'phone' ? 'glass' : 'neutral'}
      wide={layout === 'desktop'}
      onClick={() => {
        showNextDay()
        // As Le fil: the day just loaded comes up to the top.
        revealDay(nextDay)
      }}
      icon={ArrowDown}
    >
      {loadDayLabel(nextDay, layout === 'phone')}
    </Button>
  )
  // Held under the header on a computer, as Vidéos' filters; above the list on a phone.
  const filters = words.length > 1 && items !== null && items.length > 0 && !error && (
    <SubjectFilters
      words={words}
      inDays={inDays ?? []}
      chosen={chosen}
      className={rowClass}
      subjectsOf={subjectsOf}
      onChoose={setSubject}
    />
  )
  const content = (
    <FollowedContent words={words} error={error} loading={items === null} empty={items?.length === 0} layout={layout}>
      {layout === 'phone' && filters}
      <ArticleList groups={groups} layout={layout} activeId={activeId} />
    </FollowedContent>
  )

  return layout === 'desktop' ? (
    <ListColumn
      help={<FollowedHelp layout="desktop" />}
      title={t('nav.followed')}
      meta={meta}
      pinned={filters}
      footer={footer || undefined}
      busy={items === null && words.length > 0}
    >
      {content}
    </ListColumn>
  ) : (
    <MobilePage
      help={<FollowedHelp layout="phone" />}
      title={t('nav.followed')}
      meta={meta}
      backHref={FRONT_PAGE_HREF}
      backLabel={t('nav.backToFeed')}
      footer={footer || undefined}
      busy={items === null && words.length > 0}
    >
      {content}
    </MobilePage>
  )
}

export default FollowedScreen
