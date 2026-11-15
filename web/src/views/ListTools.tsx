import { Search, Video } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TopicInfo, TopicItem } from '../api.ts'
import FilterChip from '../ui/FilterChip.tsx'
import TextField from '../ui/TextField.tsx'
import TopicCapsule from '../ui/TopicCapsule.tsx'
import styles from './ListTools.module.css'

// "Tout", one topic, or the videos.
export type ListFilter = { kind: 'all' } | { kind: 'topic'; id: string } | { kind: 'videos' }

// The topic an article was found in (the history), else those of its source: a source may have several.
const topicsOf = (item: TopicItem & { topicId?: string }, topics: TopicInfo[]) =>
  item.topicId
    ? [item.topicId]
    : topics.filter(topic => topic.sources.some(source => source.id === item.sourceId)).map(topic => topic.id)

export const passesFilter = (item: TopicItem, filter: ListFilter, topics: TopicInfo[]) =>
  filter.kind === 'topic'
    ? topicsOf(item, topics).includes(filter.id)
    : filter.kind === 'videos'
      ? item.kind === 'video'
      : true

interface ListToolsProps {
  query: string
  onQuery: (query: string) => void
  // "Chercher dans tes enregistrés".
  label: string
  // What the search left, counted under each topic.
  items: TopicItem[]
  topics: TopicInfo[]
  filter: ListFilter
  onFilter: (filter: ListFilter) => void
  layout: 'desktop' | 'phone'
}

// A list's own search, then its topics, under its header: they only sort what the list already holds, as one types.
// The topics show once there are two kinds of articles to tell apart, as in the search's results.
const ListTools = ({ query, onQuery, label, items, topics, filter, onFilter, layout }: ListToolsProps) => {
  const { t } = useTranslation()
  const counts = topics
    .map(topic => ({ topic, count: items.filter(item => topicsOf(item, topics).includes(topic.id)).length }))
    .filter(entry => entry.count > 0)
  const videos = items.filter(item => item.kind === 'video').length
  const kinds = counts.length + (videos > 0 ? 1 : 0)
  const toggle = (next: ListFilter) =>
    onFilter(JSON.stringify(next) === JSON.stringify(filter) ? { kind: 'all' } : next)

  return (
    <div className={layout === 'phone' ? styles.phone : styles.desktop}>
      <div className={styles.field} role="search">
        <TextField
          icon={Search}
          type="search"
          aria-label={label}
          placeholder={label}
          value={query}
          onChange={event => onQuery(event.target.value)}
          onClear={() => onQuery('')}
          enterKeyHint="search"
          autoComplete="off"
        />
      </div>
      {(kinds > 1 || filter.kind !== 'all') && (
        <div className={`${styles.filters} no-scrollbar edge-fade`} role="group" aria-label={t('lists.filter')}>
          <FilterChip selected={filter.kind === 'all'} count={items.length} onClick={() => onFilter({ kind: 'all' })}>
            {t('feed.allTopics')}
          </FilterChip>
          {counts.map(({ topic, count }) => (
            <TopicCapsule
              key={topic.id}
              topicId={topic.id}
              label={`${topic.label} · ${count}`}
              size="filter"
              selected={filter.kind === 'topic' && filter.id === topic.id}
              onClick={() => toggle({ kind: 'topic', id: topic.id })}
            />
          ))}
          {videos > 0 && (
            <FilterChip
              selected={filter.kind === 'videos'}
              count={videos}
              icon={Video}
              onClick={() => toggle({ kind: 'videos' })}
            >
              {t('nav.watch')}
            </FilterChip>
          )}
        </div>
      )}
    </div>
  )
}

export default ListTools
