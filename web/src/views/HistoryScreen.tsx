import { AlertCircle, History, SearchX, Trash2, Undo2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { groupByDay } from '../lib/day-groups.ts'
import { type MouseEvent, type ReactNode, useEffect, useState } from 'react'
import { type HistoryEntry, type TopicInfo, type TopicItem, UnauthorizedError, getHistory } from '../api.ts'
import { matchesWords, searchWords } from '../lib/find.ts'
import { dayOfItem } from '../lib/format.ts'
import { clearRead, closeArticle, isRead, markUnread, useReadState } from '../lib/read-state.ts'
import { askToConfirm } from '../lib/confirm.ts'
import { showDone } from '../lib/toast.ts'
import { CLOSE_READER, HISTORY_HREF, SETTINGS_HREF } from '../lib/use-hash-route.ts'
import EmptyState from '../ui/EmptyState.tsx'
import Button from '../ui/Button.tsx'
import RoundButton, { CARD_BUTTON } from '../ui/RoundButton.tsx'
import { ListSkeleton } from '../ui/Skeleton.tsx'
import ArticleList, { type DayGroup } from './ArticleList.tsx'
import ListColumn from './ListColumn.tsx'
import ListTools, { type ListFilter, passesFilter } from './ListTools.tsx'
import RichText from '../ui/RichText.tsx'
import MobilePage from './MobilePage.tsx'

interface HistoryScreenProps {
  layout: 'desktop' | 'phone'
  topics: TopicInfo[]
  activeId?: string | null
  onUnauthorized: () => void
}

// open: the article is the one in the reader beside the list (on a computer).
const UnreadButton = ({ item, open }: { item: TopicItem; open: boolean }) => {
  const { t } = useTranslation()
  const handleClick = (event: MouseEvent) => {
    // Cards are links: the button must not open the article.
    event.preventDefault()
    event.stopPropagation()
    if (!open) return markUnread(item.id)

    // The open article stays listed as read while it shows: the reader closes first, then the article is marked
    // unread and leaves the list once. Marked before, the reader showing it again on the way would read it again.
    const close = () => {
      window.dispatchEvent(new Event(CLOSE_READER))
      closeArticle(item.id)
      markUnread(item.id)
    }
    // Already on the list's address (the article kept from another list), or once back on it: from the article's
    // address, the reader would open it again.
    if (window.location.hash === HISTORY_HREF) close()
    else {
      window.addEventListener('hashchange', close, { once: true })
      window.location.hash = HISTORY_HREF
    }
  }
  const kind = item.kind === 'video' || item.kind === 'podcast' ? item.kind : 'article'
  const label = t(`history.unread.${kind}`)

  return <RoundButton icon={Undo2} label={label} size={28} className={CARD_BUTTON} onClick={handleClick} />
}

// The last 7 days read, from the server.
const useHistory = (onUnauthorized: () => void) => {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let cancelled = false
    getHistory()
      .then(result => !cancelled && setEntries(result.items))
      .catch((loadError: unknown) => {
        if (cancelled) return
        if (loadError instanceof UnauthorizedError) onUnauthorized()
        else setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [onUnauthorized])
  return { entries, error }
}

interface ContentProps {
  error: boolean
  // The entries still read, null while they load.
  shown: HistoryEntry[] | null
  // None is left by the search or the filter.
  unmatched: boolean
  query: string
  layout: 'desktop' | 'phone'
  children: ReactNode
}

// The history that failed or is on its way, empty, with nothing matching, or the list.
const HistoryContent = ({ error, shown, unmatched, query, layout, children }: ContentProps) => {
  const { t } = useTranslation()
  if (error)
    return (
      <EmptyState tone="danger" icon={<AlertCircle size={28} />} title={t('history.loadFailed')}>
        {t('common.serverDown')}
      </EmptyState>
    )
  if (shown === null) return <ListSkeleton layout={layout} />
  if (shown.length === 0)
    return (
      <EmptyState icon={<History size={28} />} title={t('history.empty')}>
        {t('history.emptyText')}
      </EmptyState>
    )
  if (unmatched)
    return (
      <EmptyState
        icon={<SearchX size={28} />}
        title={searchWords(query).length > 0 ? t('lists.nothingFor', { query: query.trim() }) : t('lists.nothingHere')}
      >
        {t('history.noMatch')}
      </EmptyState>
    )
  return children
}

// "Historique": the articles read and videos seen in the last 7 days, under the day they were read, last read first.
// One can go back to the list as unread, or the whole history be forgotten.
const HistoryScreen = ({ layout, topics, activeId = null, onUnauthorized }: HistoryScreenProps) => {
  const { t } = useTranslation()
  const { entries, error } = useHistory(onUnauthorized)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ListFilter>({ kind: 'all' })
  const words = searchWords(query)
  useReadState()

  // Marked unread here or on another device: it leaves the list at once.
  const shown = entries?.filter(entry => isRead(entry.item.id)) ?? null
  const found = shown?.filter(entry => matchesWords(entry.item, words)) ?? []
  const listed = found.filter(entry => passesFilter(entry.item, filter, topics))
  const groups: DayGroup[] = groupByDay(
    listed,
    entry => dayOfItem(new Date(entry.readAt).toISOString()),
    entry => entry.item
  )

  const clear = () =>
    askToConfirm({
      title: t('confirm.history.title'),
      message: <RichText i18nKey="confirm.history.message" />,
      label: t('confirm.history.button'),
      onConfirm: () => {
        clearRead()
        showDone(t('history.cleared'))
      }
    })

  const footer = shown && shown.length > 0 && (
    <Button look="danger" wide={layout !== 'phone'} onClick={clear} icon={Trash2}>
      {t('history.clear')}
    </Button>
  )
  const content = (
    <HistoryContent error={error} shown={shown} unmatched={listed.length === 0} query={query} layout={layout}>
      <ArticleList
        groups={groups}
        highlight={words}
        layout={layout}
        activeId={activeId}
        action={item => <UnreadButton item={item} open={item.id === activeId} />}
        dismissible={false}
        fadeRead={false}
      />
    </HistoryContent>
  )

  const search = shown && shown.length > 0 && (
    <ListTools
      query={query}
      onQuery={setQuery}
      label={t('history.search')}
      items={found.map(entry => entry.item)}
      topics={topics}
      filter={filter}
      onFilter={setFilter}
      layout={layout}
    />
  )

  return layout === 'desktop' ? (
    <ListColumn title={t('nav.history')} footer={footer || undefined} busy={shown === null && !error} pinned={search}>
      {content}
    </ListColumn>
  ) : (
    <MobilePage
      title={t('nav.history')}
      backHref={SETTINGS_HREF}
      backLabel={t('nav.backToSettings')}
      footer={footer || undefined}
      busy={shown === null && !error}
    >
      {search}
      {content}
    </MobilePage>
  )
}

export default HistoryScreen
