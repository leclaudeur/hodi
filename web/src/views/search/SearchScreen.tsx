import { Search } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TopicInfo } from '../../api.ts'
import { isHidden, updatePreferences, usePreferences } from '../../lib/preferences.ts'
import { useReadState } from '../../lib/read-state.ts'
import { rememberSearch, useRecentSearches } from '../../lib/recent-searches.ts'
import { FRONT_PAGE_HREF, searchHref } from '../../lib/use-hash-route.ts'
import { useStuck } from '../../lib/use-stuck.ts'
import PanePlaceholder from '../../ui/PanePlaceholder.tsx'
import ScrollArea from '../../ui/ScrollArea.tsx'
import { ListSkeleton } from '../../ui/Skeleton.tsx'
import ArticleList from '../ArticleList.tsx'
import columnStyles from '../ListColumn.module.css'
import {
  type Filter,
  NoResults,
  RecentList,
  ResultsSummary,
  SearchField,
  SearchFilters,
  SearchLists,
  TrendList
} from './SearchParts.tsx'
import styles from './SearchScreen.module.css'
import { MIN_LENGTH, type Results, useSearch, useTrends } from './use-search.ts'

// The query of the last search, so the column finds it again after an article (and the phone after "Retour").
let lastQuery = ''

// Adds the words to the followed ones, or takes them away.
const toggleFollowed = (followedWords: string[], words: string, following: boolean) =>
  updatePreferences(
    {
      followedWords: following
        ? followedWords.filter(word => word.toLowerCase() !== words.toLowerCase())
        : [...followedWords, words]
    },
    { quiet: true }
  )

interface ResultsProps {
  shown: Results
  searching: boolean
  topics: TopicInfo[]
  filter: Filter
  onFilter: (filter: Filter) => void
  layout: 'desktop' | 'phone'
  activeId: string | null
  trimmed: string
}

// The filters, the count and the list of a search; its failure; or nothing found.
const SearchResults = ({ shown, searching, topics, filter, onFilter, layout, activeId, trimmed }: ResultsProps) => {
  const { t } = useTranslation()
  const preferences = usePreferences()
  const checking = 'checking' in shown ? shown.checking : 0
  if ('error' in shown)
    return (
      <div className={searching ? styles.stale : undefined} aria-busy={searching}>
        <p className={styles.message}>{t('search.failed')}</p>
      </div>
    )
  // Hidden sources and muted words stay hidden here too; read articles are still found.
  const found = shown.items.filter(item => !isHidden(item, { ...preferences, hideRead: false }))
  const items = found.filter(item =>
    filter.kind === 'topic' ? item.topicId === filter.id : filter.kind === 'videos' ? item.kind === 'video' : true
  )
  const { followedWords } = preferences
  const following = followedWords.some(word => word.toLowerCase() === trimmed.toLowerCase())
  return (
    <div className={searching ? styles.stale : undefined} aria-busy={searching || checking > 0}>
      {found.length > 0 && <SearchFilters found={found} topics={topics} filter={filter} onFilter={onFilter} />}
      <ResultsSummary
        found={found.length}
        checking={checking}
        following={following}
        onFollow={() => toggleFollowed(followedWords, trimmed, following)}
      />
      {found.length === 0 && checking === 0 ? (
        <NoResults query={shown.query} />
      ) : (
        <ArticleList
          groups={[{ day: null, items }]}
          layout={layout}
          activeId={activeId}
          highlight={trimmed.split(/\s+/).filter(Boolean)}
          onOpen={() => rememberSearch(trimmed)}
        />
      )}
    </div>
  )
}

// A full page on a phone; on a computer, a column whose field stays above the scrolled results.
const SearchFrame = ({ isPhone, field, content }: { isPhone: boolean; field: ReactNode; content: ReactNode }) => {
  const { t } = useTranslation()
  const [sentinel, stuck] = useStuck()
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

interface SearchScreenProps {
  layout: 'desktop' | 'phone'
  // From the address: #/search/<words>.
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
  const [query, setQuery] = useState(initialQuery || lastQuery)
  const [filter, setFilter] = useState<Filter>({ kind: 'all' })
  const input = useRef<HTMLInputElement>(null)
  // An article put away leaves the list at once.
  useReadState()
  const recent = useRecentSearches()
  const trends = useTrends()
  const trimmed = query.trim()
  const shown = useSearch(trimmed, onUnauthorized)
  const isPhone = layout === 'phone'

  useEffect(() => {
    if (!trimmed) input.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- focused once, when the search opens
  }, [])

  useEffect(() => {
    lastQuery = trimmed
    // Kept in the address, so coming back from an article shows the same results; not while an article is open.
    if (window.location.hash.startsWith('#/search')) window.history.replaceState(null, '', searchHref(trimmed))
  }, [trimmed])

  const search = (next: string) => {
    setQuery(next)
    setFilter({ kind: 'all' })
    rememberSearch(next)
  }

  const field = (
    <SearchField
      query={query}
      isPhone={isPhone}
      inputRef={input}
      onQuery={next => {
        setQuery(next)
        setFilter({ kind: 'all' })
      }}
      onSubmit={() => {
        rememberSearch(trimmed)
        input.current?.blur()
      }}
      onClose={onClose ?? closeSearch}
    />
  )
  const results = shown && (
    <SearchResults
      shown={shown}
      searching={shown.query !== trimmed}
      topics={topics}
      filter={filter}
      onFilter={setFilter}
      layout={layout}
      activeId={activeId}
      trimmed={trimmed}
    />
  )
  const content = (
    <>
      {trimmed.length >= MIN_LENGTH && shown === null ? <ListSkeleton rows={3} layout={layout} /> : results}
      <SearchLists
        searched={shown !== null}
        recent={recent.length > 0 && <RecentList recent={recent} isPhone={isPhone} onSearch={search} />}
        trends={trends.length > 0 && <TrendList trends={trends} onSearch={search} />}
      />
    </>
  )

  return <SearchFrame isPhone={isPhone} field={field} content={content} />
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
