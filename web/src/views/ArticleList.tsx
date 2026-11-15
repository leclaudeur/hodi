import { Fragment, type ReactNode, useEffect, useRef, useState } from 'react'
import type { TopicItem } from '../api.ts'
import { dayLabel } from '../lib/format.ts'
import { stateWords } from '../lib/listen.ts'
import { useReadableOffline } from '../lib/offline.ts'
import { updatePreferences, usePreferences } from '../lib/preferences.ts'
import { useMedia } from '../lib/use-media.ts'
import { dismissArticle, isRead, markRead, useReadState } from '../lib/read-state.ts'
import { rememberList } from '../lib/reading-list.ts'
import { useSaved } from '../lib/saved.ts'
import ArticleCard from '../ui/ArticleCard.tsx'
import DaySeparator, { type CountUnit } from '../ui/DaySeparator.tsx'
import SwipeCard, { UndoRow } from '../ui/SwipeCard.tsx'
import styles from './ArticleList.module.css'

export interface DayGroup {
  // YYYY-MM-DD, or null for a list without days (saved articles).
  day: string | null
  items: TopicItem[]
}

interface ArticleListProps {
  groups: DayGroup[]
  // desktop: list rows. phone: compact cards, in a grid on a tablet.
  layout: 'desktop' | 'phone'
  // The article open beside the list.
  activeId?: string | null
  // Every article of the list, for the reader's "Article suivant".
  allItems?: TopicItem[]
  // The searched words, marked in the titles.
  highlight?: string[]
  // One more button on each card, beside its bookmark.
  action?: (item: TopicItem) => ReactNode
  // What the day separators count: "12 ARTICLES", "4 ÉLÉMENTS".
  unit?: CountUnit
  // What a card shows in place of its source and age ("Partages": who sent it, and when).
  metaOf?: (item: TopicItem) => { byline?: ReactNode; note?: ReactNode; quote?: string | null }
  // Cards can be put away (a swipe on a phone, "Masquer" on hover): not in the history or the saved ones.
  dismissible?: boolean
  // Read cards fade back (not in the saved ones or the history, where they stay to be used).
  fadeRead?: boolean
  onOpen?: (item: TopicItem) => void
}

// A card of the list, and whether a line goes before it.
type Row = { item: TopicItem; line: boolean }
// Cards put away while the list is open: each stays in its place as its title and "Annuler", so reading on
// is not jolted. Leaving the list (or closing the app) puts them away for good.
const usePendingDismissals = () => {
  const [pending, setPending] = useState<string[]>([])
  const held = useRef(new Set<string>())

  useEffect(() => {
    const ids = held.current
    const flush = () => {
      for (const id of ids) dismissArticle(id)
      ids.clear()
    }
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [])

  const dismiss = (id: string) => {
    if (held.current.has(id)) return
    held.current.add(id)
    setPending(ids => [...ids, id])
  }

  const undo = (id: string) => {
    held.current.delete(id)
    setPending(ids => ids.filter(other => other !== id))
  }

  return { pending, dismiss, undo }
}

// Once per profile, on a touch screen, the first card shows what a swipe does, then never again.
const useSwipeHint = (firstDay: TopicItem[], swipeable: boolean) => {
  const { swipeHinted } = usePreferences()
  const touch = useMedia('(pointer: coarse)')
  const saved = useSaved()
  // A saved card cannot be put away: the hint goes on the first one that can.
  return !swipeHinted && touch && swipeable
    ? firstDay.find(item => !saved.some(entry => entry.item.id === item.id))?.id
    : undefined
}

// Each day's cards, each with whether a line goes before it: none next to the open card.
const rowsOf = (groups: { items: TopicItem[] }[], activeId: string | null): Row[][] =>
  groups.map(group =>
    group.items.map((item, index) => {
      const previous = group.items[index - 1]
      return { item, line: previous !== undefined && previous.id !== activeId && item.id !== activeId }
    })
  )

interface DismissibleProps {
  item: TopicItem
  pending: boolean
  swipeable: boolean
  hint: boolean
  onUndo: () => void
  onDismiss: () => void
  children: ReactNode
}

// A card put away shows its undo row; on a phone a card swipes away.
const Dismissible = ({ item, pending, swipeable, hint, onUndo, onDismiss, children }: DismissibleProps) => {
  if (pending) return <UndoRow label={stateWords(item).undo} title={item.title} onUndo={onUndo} />
  if (!swipeable) return children
  return (
    <SwipeCard
      item={item}
      onDismiss={onDismiss}
      hint={hint}
      onHinted={() => updatePreferences({ swipeHinted: true }, { quiet: true })}
    >
      {children}
    </SwipeCard>
  )
}

// Articles, grouped by day under sticky separators, with a line between rows (none around the open one).
const ArticleList = ({
  groups: allGroups,
  layout,
  activeId = null,
  allItems,
  highlight,
  action,
  unit,
  dismissible = true,
  fadeRead = true,
  metaOf,
  onOpen
}: ArticleListProps) => {
  useReadState()
  const readable = useReadableOffline()
  const groups = allGroups
    .map(group => ({ ...group, items: group.items.filter(readable) }))
    .filter(group => group.items.length > 0)
  const { pending, dismiss, undo } = usePendingDismissals()
  const hintId = useSwipeHint(groups[0]?.items ?? [], dismissible && layout === 'phone')
  const everything = allItems ?? groups.flatMap(group => group.items)
  const open = (item: TopicItem) => {
    markRead(item.id)
    rememberList(everything)
    onOpen?.(item)
  }

  const rows = rowsOf(groups, activeId)

  return (
    <div className={`${styles.list} ${styles[layout]} appear`}>
      {groups.map((group, groupIndex) => (
        <section
          key={group.day ?? 'all'}
          aria-label={group.day ? dayLabel(group.day) : undefined}
          data-day={group.day ?? undefined}
        >
          {group.day && (
            <DaySeparator label={dayLabel(group.day)} count={group.items.length} first={groupIndex === 0} unit={unit} />
          )}
          <div className={styles.items}>
            {(rows[groupIndex] ?? []).map(row => {
              const divider = row.line && <div className={styles.divider} aria-hidden="true" />
              const item = row.item
              const variant = layout === 'desktop' ? 'row' : 'compact'
              const card = (
                <ArticleCard
                  item={item}
                  variant={variant}
                  read={isRead(item.id)}
                  fadeRead={fadeRead}
                  active={item.id === activeId}
                  highlight={highlight}
                  action={action?.(item)}
                  {...metaOf?.(item)}
                  onDismiss={dismissible ? () => dismiss(item.id) : undefined}
                  onOpen={open}
                  priority={groupIndex === 0 && item.id === groups[0]?.items[0]?.id}
                />
              )
              return (
                <Fragment key={item.id}>
                  {divider}
                  <Dismissible
                    item={item}
                    pending={pending.includes(item.id)}
                    swipeable={dismissible && layout === 'phone'}
                    hint={item.id === hintId}
                    onUndo={() => undo(item.id)}
                    onDismiss={() => dismiss(item.id)}
                  >
                    {card}
                  </Dismissible>
                </Fragment>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

export default ArticleList
