import { Activity, AlertCircle, ArrowDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import PageHelp from '../ui/PageHelp.tsx'
import HelpButton from '../ui/HelpButton.tsx'
import { useEffect, useState } from 'react'
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

interface FollowedScreenProps {
  layout: 'desktop' | 'phone'
  activeId?: string | null
  onUnauthorized: () => void
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
  // As Le fil: the latest day first, "Charger <jour>" for each one before. The counts follow the days shown.
  const [dayCount, setDayCount] = useState(1)
  const days = [...new Set((items ?? []).map(item => dayOfItem(item.publishedAt)))]
  const daysShown = new Set(days.slice(0, dayCount))
  const nextDay = days[dayCount] ?? null
  const inDays = items?.filter(item => daysShown.has(dayOfItem(item.publishedAt))) ?? null
  const shown = chosen === null ? inDays : (inDays?.filter(item => subjectsOf(item).includes(chosen)) ?? null)

  // Opening the list clears the count on the app icon.
  useEffect(() => {
    void markFollowedSeen()
  }, [])

  const groups: DayGroup[] = []
  for (const item of shown ?? []) {
    const day = dayOfItem(item.publishedAt)
    const group = groups.at(-1)
    if (group?.day === day) group.items.push(item)
    else groups.push({ day, items: [item] })
  }

  const meta =
    inDays && inDays.length > 0
      ? `${t('count.article', { count: inDays.length })} · ${t('count.subject', { count: words.length })}`
      : undefined
  const footer = nextDay && !error && (
    <Button
      look={layout === 'phone' ? 'glass' : 'neutral'}
      wide={layout === 'desktop'}
      onClick={() => setDayCount(count => count + 1)}
      icon={ArrowDown}
    >
      {loadDayLabel(nextDay, layout === 'phone')}
    </Button>
  )
  // Held under the header on a computer, as Vidéos' filters; above the list on a phone.
  const filters = words.length > 1 && items !== null && items.length > 0 && !error && (
    <div className={`${rowClass} no-scrollbar edge-fade`} role="group" aria-label={t('followed.filter')}>
      <FilterChip selected={chosen === null} count={inDays?.length ?? 0} onClick={() => setSubject(null)}>
        {t('feed.allTopics')}
      </FilterChip>
      {words.map(word => {
        const count = (inDays ?? []).filter(item => subjectsOf(item).includes(word)).length
        return (
          <FilterChip
            key={word}
            selected={chosen === word}
            count={count}
            disabled={count === 0}
            onClick={() => setSubject(chosen === word ? null : word)}
          >
            {word}
          </FilterChip>
        )
      })}
    </div>
  )
  const content =
    words.length === 0 ? (
      <EmptyState
        icon={<Activity size={28} />}
        title={t('followed.none')}
        actions={<Button onClick={() => (window.location.hash = SETTINGS_HREF)}>{t('followed.add')}</Button>}
      >
        {t('followed.noneText')}
      </EmptyState>
    ) : error ? (
      <EmptyState tone="danger" icon={<AlertCircle size={28} />} title={t('followed.loadFailed')}>
        {t('common.serverDown')}
      </EmptyState>
    ) : items === null ? (
      <ListSkeleton layout={layout} />
    ) : items.length === 0 ? (
      <EmptyState icon={<Activity size={28} />} title={t('feed.nothingNew')}>
        {t('followed.nothingNew')}
      </EmptyState>
    ) : (
      <>
        {layout === 'phone' && filters}
        <ArticleList groups={groups} layout={layout} activeId={activeId} />
      </>
    )

  return layout === 'desktop' ? (
    <ListColumn
      help={
        <HelpButton id="followed_help" title={t('help.followed.title')} layout="desktop">
          <PageHelp page="followed" layout="desktop" />
        </HelpButton>
      }
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
      help={
        <HelpButton id="followed_help" title={t('help.followed.title')} layout="phone">
          <PageHelp page="followed" layout="phone" />
        </HelpButton>
      }
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
