import { Activity, ArrowLeft, History, Plus, Search, SearchX, Video, X } from 'lucide-react'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  type SearchResult,
  type TopicInfo,
  type Trend,
  UnauthorizedError,
  getTrends,
  searchArticles
} from '../../api.ts'
import { isHidden, updatePreferences, usePreferences } from '../../lib/preferences.ts'
import { useReadState } from '../../lib/read-state.ts'
import { forgetSearch, rememberSearch, useRecentSearches } from '../../lib/recent-searches.ts'
import { FRONT_PAGE_HREF, searchHref } from '../../lib/use-hash-route.ts'
import { useStuck } from '../../lib/use-stuck.ts'
import FilterChip from '../../ui/FilterChip.tsx'
import PanePlaceholder from '../../ui/PanePlaceholder.tsx'
import RoundButton from '../../ui/RoundButton.tsx'
import ScrollArea from '../../ui/ScrollArea.tsx'
import { ListSkeleton } from '../../ui/Skeleton.tsx'
import TopicCapsule from '../../ui/TopicCapsule.tsx'
import ArticleList from '../ArticleList.tsx'
import columnStyles from '../ListColumn.module.css'
import styles from './SearchScreen.module.css'

// Waits for a pause in typing before asking the server.
const DEBOUNCE_MS = 300
const MIN_LENGTH = 2
// The server checks matching articles it has not opened yet: searched again until it is done.
const POLL_INTERVAL_MS = 2500
const MAX_POLLS = 8

type Results = ({ query: string } & SearchResult) | { query: string; error: true }
// "Tout", one topic, or the videos.
type Filter = { kind: 'all' } | { kind: 'topic'; id: string } | { kind: 'videos' }

// The query of the last search, so the column finds it again after an article (and the phone after "Retour").
let lastQuery = ''

// Trends of the visit: worked out again by the server every ten minutes at most.
let knownTrends: Trend[] | null = null

const useTrends = () => {
  const [trends, setTrends] = useState(knownTrends)
  useEffect(() => {
    getTrends()
      .then(next => {
        knownTrends = next
        setTrends(next)
      })
      .catch(() => {})
  }, [])
  return trends ?? []
}

const useSearch = (trimmed: string, onUnauthorized: () => void) => {
  const [results, setResults] = useState<Results | null>(null)

  useEffect(() => {
    if (trimmed.length < MIN_LENGTH) return

    let cancelled = false
    let polls = 0
    const search = () => {
      searchArticles(trimmed)
        .then(result => {
          if (cancelled) return
          // Only while the page is shown: no requests for a hidden app.
          const polling = result.checking > 0 && ++polls < MAX_POLLS && document.visibilityState === 'visible'
          setResults({ query: trimmed, ...result, checking: polling ? result.checking : 0 })
          if (polling) timer = window.setTimeout(search, POLL_INTERVAL_MS)
        })
        .catch((searchError: unknown) => {
          if (cancelled) return
          if (searchError instanceof UnauthorizedError) onUnauthorized()
          else setResults({ query: trimmed, error: true })
        })
    }
    let timer = window.setTimeout(search, DEBOUNCE_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [trimmed, onUnauthorized])

  return trimmed.length >= MIN_LENGTH ? results : null
}

const focusFirstResult = (event: KeyboardEvent<HTMLInputElement>) => {
  if (event.key !== 'ArrowDown') return
  const link = document.querySelector<HTMLElement>('[data-card] a')
  if (!link) return
  event.preventDefault()
  link.focus()
}

interface SearchScreenProps {
  layout: 'desktop' | 'phone'
  // From the address: #/recherche/<words>.
  initialQuery: string
  topics: TopicInfo[]
  // The article open beside the results.
  activeId?: string | null
  onClose?: () => void
  onUnauthorized: () => void
}

// The search: a column beside the reader on a computer, a full page on a phone.
// Before a search: trends of the last 48 hours, recent searches and (phone) the topics.
const SearchScreen = ({
  layout,
  initialQuery,
  topics,
  activeId = null,
  onClose,
  onUnauthorized
}: SearchScreenProps) => {
  const { t } = useTranslation()
  const [query, setQuery] = useState(initialQuery || lastQuery)
  const [filter, setFilter] = useState<Filter>({ kind: 'all' })
  const input = useRef<HTMLInputElement>(null)
  const preferences = usePreferences()
  // An article put away leaves the list at once.
  useReadState()
  const recent = useRecentSearches()
  const trends = useTrends()
  const trimmed = query.trim()
  const shown = useSearch(trimmed, onUnauthorized)
  const searching = shown !== null && shown.query !== trimmed

  useEffect(() => {
    if (!trimmed) input.current?.focus()
    // Focused once, when the search opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    lastQuery = trimmed
    // Kept in the address, so coming back from an article shows the same results; not while an article is open.
    if (window.location.hash.startsWith('#/recherche')) window.history.replaceState(null, '', searchHref(trimmed))
  }, [trimmed])

  const search = (next: string) => {
    setQuery(next)
    setFilter({ kind: 'all' })
    rememberSearch(next)
  }

  // Hidden sources and muted words stay hidden here too; read articles are still found.
  const found =
    shown && !('error' in shown) ? shown.items.filter(item => !isHidden(item, { ...preferences, hideRead: false })) : []
  const topicCounts = topics
    .map(topic => ({ topic, count: found.filter(item => item.topicId === topic.id).length }))
    .filter(entry => entry.count > 0)
  const videoCount = found.filter(item => item.kind === 'video').length
  const items = found.filter(item =>
    filter.kind === 'topic' ? item.topicId === filter.id : filter.kind === 'videos' ? item.kind === 'video' : true
  )
  const words = trimmed.split(/\s+/).filter(Boolean)
  const { followedWords } = preferences
  const following = followedWords.some(word => word.toLowerCase() === trimmed.toLowerCase())
  const isPhone = layout === 'phone'
  const [sentinel, stuck] = useStuck()

  const field = (
    <form
      className={styles.form}
      role="search"
      onSubmit={event => {
        event.preventDefault()
        rememberSearch(trimmed)
        input.current?.blur()
      }}
    >
      {/* Leaving the search is a way back, apart from the field; its cross only empties it. */}
      <RoundButton
        icon={ArrowLeft}
        label={t('search.close')}
        size={44}
        variant={isPhone ? 'glass' : 'default'}
        onClick={onClose ?? closeSearch}
      />
      <label className={styles.field}>
        <Search size={18} aria-hidden="true" className={styles.fieldIcon} />
        <input
          ref={input}
          className={styles.input}
          type="search"
          value={query}
          onChange={event => {
            setQuery(event.target.value)
            setFilter({ kind: 'all' })
          }}
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
              setQuery('')
              input.current?.focus()
            }}
          >
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </label>
    </form>
  )

  const recentList = recent.length > 0 && (
    <section className={styles.section} aria-labelledby="search-recent">
      <h2 id="search-recent" className={styles.label}>
        <span>{t('search.recent')}</span>
        <span className={styles.labelLine} aria-hidden="true" />
        <span>{t('count.search', { count: recent.length })}</span>
      </h2>
      <ul>
        {recent.map(entry => (
          <li key={entry} className={styles.recent}>
            <button type="button" className={styles.recentButton} onClick={() => search(entry)}>
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

  const trendList = trends.length > 0 && (
    <section className={styles.section} aria-labelledby="search-trends">
      <h2 id="search-trends" className={styles.label}>
        <span>{t('search.trends')}</span>
        <span className={styles.labelLine} aria-hidden="true" />
        <span>48 h</span>
      </h2>
      <ol>
        {trends.map((trend, index) => (
          <li key={trend.label}>
            <button type="button" className={styles.trend} onClick={() => search(trend.label)}>
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

  const filters = found.length > 0 && (
    <div className={`${styles.filters} no-scrollbar edge-fade`} role="group" aria-label={t('search.filter')}>
      <FilterChip selected={filter.kind === 'all'} count={found.length} onClick={() => setFilter({ kind: 'all' })}>
        {t('feed.allTopics')}
      </FilterChip>
      {topicCounts.map(({ topic, count }) => (
        <TopicCapsule
          key={topic.id}
          topicId={topic.id}
          label={`${topic.label} · ${count}`}
          size="filter"
          selected={filter.kind === 'topic' && filter.id === topic.id}
          onClick={() =>
            setFilter(
              filter.kind === 'topic' && filter.id === topic.id ? { kind: 'all' } : { kind: 'topic', id: topic.id }
            )
          }
        />
      ))}
      {videoCount > 0 && (
        <FilterChip
          selected={filter.kind === 'videos'}
          count={videoCount}
          icon={Video}
          onClick={() => setFilter(filter.kind === 'videos' ? { kind: 'all' } : { kind: 'videos' })}
        >
          {t('nav.watch')}
        </FilterChip>
      )}
    </div>
  )

  const results = shown && (
    <div
      className={searching ? styles.stale : undefined}
      aria-busy={searching || ('checking' in shown && shown.checking > 0)}
    >
      {'error' in shown ? (
        <p className={styles.message}>{t('search.failed')}</p>
      ) : (
        <>
          {filters}
          <div className={styles.summary}>
            <span className="mono">
              {found.length === 0 && shown.checking > 0
                ? t('search.searching')
                : t('count.result', { count: found.length })}
              {found.length > 0 && shown.checking > 0 && ` · ${t('search.more')}`}
            </span>
            <button
              type="button"
              className={`${styles.follow} ${following ? styles.following : ''}`}
              aria-pressed={following}
              onClick={() =>
                updatePreferences(
                  {
                    followedWords: following
                      ? followedWords.filter(word => word.toLowerCase() !== trimmed.toLowerCase())
                      : [...followedWords, trimmed]
                  },
                  { quiet: true }
                )
              }
            >
              {following ? <Activity size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
              {t(following ? 'search.following' : 'search.follow')}
            </button>
          </div>
          {found.length === 0 && shown.checking === 0 ? (
            <div className={styles.none}>
              <SearchX size={22} aria-hidden="true" />
              <p>
                {t('search.nothing', { query: shown.query })}
                <span>{t('search.nothingText')}</span>
              </p>
            </div>
          ) : (
            <ArticleList
              groups={[{ day: null, items }]}
              layout={layout}
              activeId={activeId}
              highlight={words}
              onOpen={() => rememberSearch(trimmed)}
            />
          )}
        </>
      )}
    </div>
  )

  const waiting = trimmed.length >= MIN_LENGTH && shown === null
  const content = (
    <>
      {waiting ? <ListSkeleton rows={3} layout={layout} /> : results}
      {shown ? (
        <>
          {recentList}
          {trendList}
        </>
      ) : (
        <>
          {trendList}
          {recentList}
        </>
      )}
    </>
  )

  if (isPhone)
    return (
      <section className={`${styles.screen} ${styles.phone}`} aria-label={t('search.title')}>
        <div ref={sentinel} className="stuck-sentinel" aria-hidden="true" />
        <div className={`${styles.header} ${stuck ? styles.stuck : ''}`}>{field}</div>
        {content}
      </section>
    )

  return (
    <section className={columnStyles.column} aria-label={t('search.title')}>
      <div className={`${styles.header} ${stuck ? styles.stuck : ''}`}>{field}</div>
      <ScrollArea className={columnStyles.scroll}>
        <div ref={sentinel} className="stuck-sentinel" aria-hidden="true" />
        <div className={styles.screen}>{content}</div>
      </ScrollArea>
    </section>
  )
}

// The back button goes back, or home when the search was opened directly.
export const closeSearch = () => {
  if (window.history.length > 1) window.history.back()
  else window.location.hash = FRONT_PAGE_HREF
}

export default SearchScreen

// Beside the results on a computer, until one is opened.
export const SearchPlaceholder = () => {
  const { t } = useTranslation()
  return (
    <PanePlaceholder icon={<Search size={20} />} title={t('pane.result')}>
      {t('pane.resultText')}
    </PanePlaceholder>
  )
}
