import { Bookmark, SearchX } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import type { TopicInfo } from '../api.ts'
import { matchesWords, searchWords } from '../lib/find.ts'
import { dayOfItem } from '../lib/format.ts'
import { useSaved } from '../lib/saved.ts'
import { FRONT_PAGE_HREF } from '../lib/use-hash-route.ts'
import EmptyState from '../ui/EmptyState.tsx'
import ArticleList, { type DayGroup } from './ArticleList.tsx'
import ListColumn from './ListColumn.tsx'
import ListTools, { type ListFilter, passesFilter } from './ListTools.tsx'
import MobilePage from './MobilePage.tsx'

interface SavedScreenProps {
  layout: 'desktop' | 'phone'
  topics: TopicInfo[]
  activeId?: string | null
}

// "Enregistrés": the saved articles, last saved first, under the day they were saved. They open even once
// out of the feeds.
const SavedScreen = ({ layout, topics, activeId = null }: SavedScreenProps) => {
  const { t } = useTranslation()
  const entries = useSaved()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ListFilter>({ kind: 'all' })
  const words = searchWords(query)
  const found = entries.filter(entry => matchesWords(entry.item, words))
  const shown = found.filter(entry => passesFilter(entry.item, filter, topics))
  const groups: DayGroup[] = []
  for (const { item, savedAt } of shown) {
    const day = dayOfItem(savedAt)
    const group = groups.at(-1)
    if (group?.day === day) group.items.push(item)
    else groups.push({ day, items: [item] })
  }

  const meta = entries.length > 0 ? t('count.article', { count: entries.length }) : undefined
  const content =
    entries.length === 0 ? (
      <EmptyState icon={<Bookmark size={28} />} title={t('saved.empty')}>
        {t('saved.emptyText')}
      </EmptyState>
    ) : shown.length === 0 ? (
      <EmptyState
        icon={<SearchX size={28} />}
        title={words.length > 0 ? t('lists.nothingFor', { query: query.trim() }) : t('lists.nothingHere')}
      >
        {t('saved.noMatch')}
      </EmptyState>
    ) : (
      <ArticleList
        groups={groups}
        layout={layout}
        activeId={activeId}
        dismissible={false}
        fadeRead={false}
        highlight={words}
      />
    )
  const search = entries.length > 0 && (
    <ListTools
      query={query}
      onQuery={setQuery}
      label={t('saved.search')}
      items={found.map(entry => entry.item)}
      topics={topics}
      filter={filter}
      onFilter={setFilter}
      layout={layout}
    />
  )

  return layout === 'desktop' ? (
    <ListColumn title={t('nav.saved')} meta={meta} pinned={search}>
      {content}
    </ListColumn>
  ) : (
    <MobilePage title={t('nav.saved')} meta={meta} backHref={FRONT_PAGE_HREF} backLabel={t('nav.backToFeed')}>
      {search}
      {content}
    </MobilePage>
  )
}

export default SavedScreen
