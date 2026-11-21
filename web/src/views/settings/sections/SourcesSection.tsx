import { EyeOff, LibraryBig, Search } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SourceStatus, TopicInfo } from '../../../api.ts'
import { setMySources, usePreferences } from '../../../lib/preferences.ts'
import { showSaved } from '../../../lib/toast.ts'
import { catalogueHref } from '../../../lib/use-hash-route.ts'
import { useMyRequests } from '../../../lib/my-requests.ts'
import { isYoung, useProfiles } from '../../../lib/profiles.ts'
import { useSourceEngagement, useSourceStatuses } from '../../../lib/settings-data.ts'
import AddSourceCard from '../../../ui/AddSourceCard.tsx'
import Button from '../../../ui/Button.tsx'
import StatusLine from '../../../ui/StatusLine.tsx'
import TextField from '../../../ui/TextField.tsx'
import SectionPage from '../SectionPage.tsx'
import RowsSkeleton from '../SettingsSkeleton.tsx'
import AddSourceDialog, { type AddSourceRequest } from './AddSourceDialog.tsx'
import AskSourceDialog from './AskSourceDialog.tsx'
import sourceStyles from './SourcesSection.module.css'
import { type SourceFilter, StatusSelect, TopicFilter } from './SourceFilters.tsx'
import MySourceCard from './MySourceCard.tsx'
import { GridSection, RequestCards } from './SourceGrids.tsx'
import SourceTopicsDialog, { type TopicsEdit } from './SourceTopicsDialog.tsx'
import { filterSources, gridsOf } from './sources-model.ts'
import { useSourceActions } from './use-source-actions.tsx'

interface SourcesSectionProps {
  topics: TopicInfo[]
  layout: 'desktop' | 'phone'
  onUnauthorized: () => void
}

// The profile reading the list: a young one reads the sources its parents gave it and adds, changes and removes none.
// A teen asks for one.
const useReader = () => {
  const household = useProfiles({ onError: () => {} })
  const current = household?.current
  const me = household?.profiles.find(profile => profile.id === current)
  const young = me ? isYoung(me) : false
  const teen = me?.kind === 'teen'
  return { current, admin: me?.role === 'admin', young, teen }
}

// The page's state: the sources, the profile reading them, the filters and the dialogs.
const useSourcesPage = (topics: TopicInfo[], onUnauthorized: () => void) => {
  const { t } = useTranslation()
  const { value: sources, failed, replace } = useSourceStatuses(onUnauthorized)
  const { value: engagement } = useSourceEngagement(onUnauthorized)
  const preferences = usePreferences()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<SourceFilter>('all')
  // Some topics' sources only: a long list is easier to go through.
  const [topicFilter, setTopicFilter] = useState<string[]>([])
  const [adding, setAdding] = useState<AddSourceRequest | null>(null)
  const reader = useReader()
  const requests = useMyRequests(reader.teen)
  const [asking, setAsking] = useState(false)
  const hiddenSources = preferences.hiddenSources
  const actions = useSourceActions({ replace, adding, setAdding, onUnauthorized })
  const [editing, setEditing] = useState<TopicsEdit | null>(null)

  // « Mes sources » only: the others are in the catalogue.
  const mine = sources?.filter(source => !hiddenSources.includes(source.id))
  const list = filterSources({ sources: mine, topics, hiddenSources, engagement, search, filter, topicFilter })
  const grids = gridsOf(list.shown)
  const browsing = list.chosen === 'all' && list.chosenTopics.length === 0 && !list.wanted

  const takeOut = (source: SourceStatus) => {
    setMySources([source.id], false, { quiet: true })
    showSaved(t('catalogue.removed', { name: source.name }))
  }
  const add = () => setAdding({ topicId: list.chosenTopics[0] ?? null, replacing: null })

  return {
    ...{ sources, failed, search, setSearch, setFilter, setTopicFilter, adding, setAdding, add },
    ...{ reader, requests, asking, setAsking, actions, editing, setEditing, list, grids, browsing, takeOut }
  }
}

type SourcesPage = ReturnType<typeof useSourcesPage>

// One card per source, its other actions as rounds: none for a young profile, which only takes one out.
const cardOf = (page: SourcesPage) => (source: SourceStatus) => {
  const { reader, list, actions } = page
  const sourceTopics = list.topicsOf(source.id)
  const mine = reader.admin || (source.addedBy !== undefined && source.addedBy === reader.current)
  const low = list.lowOf(source.id) !== null
  const replace =
    low && !reader.young
      ? () => page.setAdding({ topicId: sourceTopics[0]?.id ?? null, replacing: { id: source.id, name: source.name } })
      : null
  const retopic =
    mine && !reader.young && source.kind === 'article' && sourceTopics.length > 0
      ? () => page.setEditing({ id: source.id, name: source.name, topicIds: sourceTopics.map(topic => topic.id) })
      : null
  return (
    <MySourceCard
      key={source.id}
      source={source}
      topics={sourceTopics}
      chosenTopics={list.chosenTopics}
      low={low}
      replace={replace}
      retopic={retopic}
      deletable={mine && !reader.young && source.addedBy !== undefined}
      removing={actions.removing === source.id}
      onRemove={() => actions.remove(source)}
      onTakeOut={() => page.takeOut(source)}
    />
  )
}

// The dashed card that adds a source, first in Mes sources; a teen's asks its parents for one, a child's is none.
const AddCard = ({ page }: { page: SourcesPage }) => {
  const { t } = useTranslation()
  const { reader } = page
  if (reader.young && !reader.teen) return null
  if (reader.teen)
    return (
      <AddSourceCard
        title={t('sourceCard.askTitle')}
        text={t('sourceCard.askText')}
        label={t('sourceCard.ask')}
        tour="ask-source"
        onAdd={() => page.setAsking(true)}
      />
    )
  return (
    <AddSourceCard
      title={t('sourceCard.addTitle')}
      text={t('sourceCard.addText')}
      label={t('sourceCard.add')}
      tour="add-source"
      onAdd={page.add}
    />
  )
}

// The grids, or why there are none: still loading, failed, or nothing matches.
const SourceGrids = ({ page }: { page: SourcesPage }) => {
  const { t } = useTranslation()
  const { list, grids, reader } = page
  if (page.failed) return <StatusLine tone="error">{t('sources.loadFailed')}</StatusLine>
  if (!page.sources) return <RowsSkeleton rows={4} lead="none" hint={false} end="round" />
  if (list.shown.length === 0 && !page.browsing) return <StatusLine tone="info">{t('sources.noMatch')}</StatusLine>
  const card = cardOf(page)
  const hideLow = (sources: SourceStatus[]) =>
    list.chosen === 'low' &&
    sources.length > 0 && (
      <Button compact look="danger" icon={EyeOff} onClick={() => page.actions.hideLow(sources)}>
        {t('sources.hideAll')}
      </Button>
    )
  return (
    <>
      {reader.teen && page.browsing && page.requests && page.requests.length > 0 && (
        <RequestCards requests={page.requests} />
      )}
      <GridSection
        title={reader.young ? t('requests.byParents') : t('sources.groups.mine')}
        count={grids.mine.length}
        action={hideLow(grids.mine)}
      >
        {page.browsing && <AddCard page={page} />}
        {grids.mine.map(card)}
      </GridSection>
      {grids.base.length > 0 && (
        <GridSection title={t('sources.groups.base')} count={grids.base.length} action={hideLow(grids.base)}>
          {grids.base.map(card)}
        </GridSection>
      )}
    </>
  )
}

// Every feed as a card, in two grids: the account's own, then the base sources (the first card adds one, by link or
// with the AI). Beside the search, the filters find the little-read, the failing ones, and a topic's. The catalogue's
// button goes under the grids, full width.
const SourcesSection = ({ topics, layout, onUnauthorized }: SourcesSectionProps) => {
  const { t } = useTranslation()
  const page = useSourcesPage(topics, onUnauthorized)
  const { list, reader } = page
  return (
    <SectionPage
      title={t('settings.nav.sources')}
      intro={t(reader.young ? 'requests.intro' : 'sources.intro')}
      layout={layout}
      wide
    >
      <div className={sourceStyles.toolbar}>
        <TextField
          icon={Search}
          type="search"
          value={page.search}
          onChange={event => page.setSearch(event.target.value)}
          placeholder={t('sources.search')}
          aria-label={t('sources.searchLabel')}
        />
        {list.counts && (
          <div className={sourceStyles.filters}>
            <StatusSelect value={list.chosen} counts={list.counts} onChange={page.setFilter} />
            {list.filterTopics.length > 1 && (
              <TopicFilter topics={list.filterTopics} selected={list.chosenTopics} onChange={page.setTopicFilter} />
            )}
          </div>
        )}
      </div>

      <SourceGrids page={page} />

      {!reader.young && (
        <div className={sourceStyles.addLine}>
          <Button icon={LibraryBig} href={catalogueHref()}>
            {t('catalogue.browse')}
          </Button>
        </div>
      )}

      <SourceTopicsDialog
        topics={topics}
        editing={page.editing}
        onEditing={page.setEditing}
        onUnauthorized={onUnauthorized}
      />

      <AskSourceDialog open={page.asking} onClose={() => page.setAsking(false)} />

      <AddSourceDialog
        topics={topics}
        request={page.adding}
        onClose={() => page.setAdding(null)}
        onAdded={page.actions.added}
        onUnauthorized={onUnauthorized}
      />
    </SectionPage>
  )
}

export default SourcesSection
