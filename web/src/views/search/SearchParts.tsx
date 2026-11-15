import { Activity, ArrowLeft, History, Plus, Search, SearchX, Video, X } from 'lucide-react'
import type { KeyboardEvent, ReactNode, RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import type { SearchItem, TopicInfo, Trend } from '../../api.ts'
import { forgetSearch } from '../../lib/recent-searches.ts'
import FilterChip from '../../ui/FilterChip.tsx'
import RoundButton from '../../ui/RoundButton.tsx'
import TopicCapsule from '../../ui/TopicCapsule.tsx'
import styles from './SearchScreen.module.css'

// "Tout", one topic, or the videos.
export type Filter = { kind: 'all' } | { kind: 'topic'; id: string } | { kind: 'videos' }

const focusFirstResult = (event: KeyboardEvent<HTMLInputElement>) => {
  if (event.key !== 'ArrowDown') return
  const link = document.querySelector<HTMLElement>('[data-card] a')
  if (!link) return
  event.preventDefault()
  link.focus()
}

interface FieldProps {
  query: string
  isPhone: boolean
  inputRef: RefObject<HTMLInputElement | null>
  onQuery: (query: string) => void
  onSubmit: () => void
  onClose: () => void
}

// The search field, with the way back before it and a cross that empties it.
export const SearchField = ({ query, isPhone, inputRef, onQuery, onSubmit, onClose }: FieldProps) => {
  const { t } = useTranslation()
  return (
    <form
      className={styles.form}
      role="search"
      onSubmit={event => {
        event.preventDefault()
        onSubmit()
      }}
    >
      {/* Leaving the search is a way back, apart from the field; its cross only empties it. */}
      <RoundButton
        icon={ArrowLeft}
        label={t('search.close')}
        size={44}
        variant={isPhone ? 'glass' : 'default'}
        onClick={onClose}
      />
      <label className={styles.field}>
        <Search size={18} aria-hidden="true" className={styles.fieldIcon} />
        <input
          ref={inputRef}
          className={styles.input}
          type="search"
          value={query}
          onChange={event => onQuery(event.target.value)}
          onKeyDown={focusFirstResult}
          placeholder={t('search.placeholder')}
          aria-label={t('nav.search')}
          enterKeyHint="search"
          autoComplete="off"
        />
        {query && (
          <button
            className={styles.clear}
            type="button"
            aria-label={t('search.clear')}
            onClick={() => {
              onQuery('')
              inputRef.current?.focus()
            }}
          >
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </label>
    </form>
  )
}

// The searches made before, each searched again by a click or forgotten.
export const RecentList = ({
  recent,
  isPhone,
  onSearch
}: {
  recent: string[]
  isPhone: boolean
  onSearch: (query: string) => void
}) => {
  const { t } = useTranslation()
  return (
    <section className={styles.section} aria-labelledby="search-recent">
      <h2 id="search-recent" className={styles.label}>
        <span>{t('search.recent')}</span>
        <span className={styles.labelLine} aria-hidden="true" />
        <span>{t('count.search', { count: recent.length })}</span>
      </h2>
      <ul>
        {recent.map(entry => (
          <li key={entry} className={styles.recent}>
            <button type="button" className={styles.recentButton} onClick={() => onSearch(entry)}>
              <History size={16} aria-hidden="true" />
              {entry}
            </button>
            {/* 28 on a desktop, as the actions of list rows. */}
            <RoundButton
              icon={X}
              size={isPhone ? 34 : 28}
              label={t('search.forget', { query: entry })}
              onClick={() => forgetSearch(entry)}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}

// The subjects most covered in the last 48 hours.
export const TrendList = ({ trends, onSearch }: { trends: Trend[]; onSearch: (query: string) => void }) => {
  const { t } = useTranslation()
  return (
    <section className={styles.section} aria-labelledby="search-trends">
      <h2 id="search-trends" className={styles.label}>
        <span>{t('search.trends')}</span>
        <span className={styles.labelLine} aria-hidden="true" />
        <span>48 h</span>
      </h2>
      <ol>
        {trends.map((trend, index) => (
          <li key={trend.label}>
            <button type="button" className={styles.trend} onClick={() => onSearch(trend.label)}>
              <span className={`${styles.rank} ${index < 2 ? styles.top : ''}`}>
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className={styles.trendLabel}>{trend.label}</span>
              <span className={styles.dot} style={{ background: `var(--topic-${trend.topicId})` }} aria-hidden="true" />
              <span className={styles.count}>{t('count.result', { count: trend.count })}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}

interface FiltersProps {
  found: SearchItem[]
  topics: TopicInfo[]
  filter: Filter
  onFilter: (filter: Filter) => void
}

// "Tout", a capsule per topic with results, and the videos; the chosen one again goes back to all.
export const SearchFilters = ({ found, topics, filter, onFilter }: FiltersProps) => {
  const { t } = useTranslation()
  const topicCounts = topics
    .map(topic => ({ topic, count: found.filter(item => item.topicId === topic.id).length }))
    .filter(entry => entry.count > 0)
  const videoCount = found.filter(item => item.kind === 'video').length
  const isTopic = (id: string) => filter.kind === 'topic' && filter.id === id
  return (
    <div className={`${styles.filters} no-scrollbar edge-fade`} role="group" aria-label={t('search.filter')}>
      <FilterChip selected={filter.kind === 'all'} count={found.length} onClick={() => onFilter({ kind: 'all' })}>
        {t('feed.allTopics')}
      </FilterChip>
      {topicCounts.map(({ topic, count }) => (
        <TopicCapsule
          key={topic.id}
          topicId={topic.id}
          label={`${topic.label} · ${count}`}
          size="filter"
          selected={isTopic(topic.id)}
          onClick={() => onFilter(isTopic(topic.id) ? { kind: 'all' } : { kind: 'topic', id: topic.id })}
        />
      ))}
      {videoCount > 0 && (
        <FilterChip
          selected={filter.kind === 'videos'}
          count={videoCount}
          icon={Video}
          onClick={() => onFilter(filter.kind === 'videos' ? { kind: 'all' } : { kind: 'videos' })}
        >
          {t('nav.watch')}
        </FilterChip>
      )}
    </div>
  )
}

interface SummaryProps {
  found: number
  checking: number
  following: boolean
  onFollow: () => void
}

// The count of results, and the button that follows the words searched.
export const ResultsSummary = ({ found, checking, following, onFollow }: SummaryProps) => {
  const { t } = useTranslation()
  return (
    <div className={styles.summary}>
      <span className="mono">
        {found === 0 && checking > 0 ? t('search.searching') : t('count.result', { count: found })}
        {found > 0 && checking > 0 && ` · ${t('search.more')}`}
      </span>
      <button
        type="button"
        className={`${styles.follow} ${following ? styles.following : ''}`}
        aria-pressed={following}
        onClick={onFollow}
      >
        {following ? <Activity size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
        {t(following ? 'search.following' : 'search.follow')}
      </button>
    </div>
  )
}

// Nothing found, once the server checked everything.
export const NoResults = ({ query }: { query: string }) => {
  const { t } = useTranslation()
  return (
    <div className={styles.none}>
      <SearchX size={22} aria-hidden="true" />
      <p>
        {t('search.nothing', { query })}
        <span>{t('search.nothingText')}</span>
      </p>
    </div>
  )
}

// Before any search, the trends come first; once searched, the recent searches come back under the results.
export const SearchLists = ({
  searched,
  recent,
  trends
}: {
  searched: boolean
  recent: ReactNode
  trends: ReactNode
}) =>
  searched ? (
    <>
      {recent}
      {trends}
    </>
  ) : (
    <>
      {trends}
      {recent}
    </>
  )
