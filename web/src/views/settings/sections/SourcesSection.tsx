import { Plus, Search } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SourceStatus, TopicInfo } from '../../../api.ts'
import { updatePreferences, usePreferences } from '../../../lib/preferences.ts'
import { useMyRequests } from '../../../lib/my-requests.ts'
import { isYoung, useProfiles } from '../../../lib/profiles.ts'
import { useSourceEngagement, useSourceStatuses } from '../../../lib/settings-data.ts'
import { useIsPhone } from '../../../lib/use-media.ts'
import { AccordionGroup } from '../../../ui/Accordion.tsx'
import Button from '../../../ui/Button.tsx'
import StatusLine from '../../../ui/StatusLine.tsx'
import TextField from '../../../ui/TextField.tsx'
import SectionPage from '../SectionPage.tsx'
import RowsSkeleton from '../SettingsSkeleton.tsx'
import AddSourceDialog, { type AddSourceRequest } from './AddSourceDialog.tsx'
import AskSourceDialog from './AskSourceDialog.tsx'
import sourceStyles from './SourcesSection.module.css'
import { type SourceFilter, StatusSelect, TopicFilter } from './SourceFilters.tsx'
import { GroupAccordion, RequestsAccordion } from './SourceGroups.tsx'
import SourceRow from './SourceRow.tsx'
import SourceTopicsDialog, { type TopicsEdit } from './SourceTopicsDialog.tsx'
import { filterSources, groupsOf, sectionsOf } from './sources-model.ts'
import { useGroupOpening, useOpenedGroups } from './use-opened-groups.ts'
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
  const nameOf = (id: number) => household?.profiles.find(profile => profile.id === id)?.name
  return { current, admin: me?.role === 'admin', young, teen, nameOf }
}

// The page's state: the sources, the profile reading them, the filters, the open groups and the dialogs.
const useSourcesPage = (topics: TopicInfo[], onUnauthorized: () => void) => {
  const { t } = useTranslation()
  const { value: sources, failed, replace } = useSourceStatuses(onUnauthorized)
  const { value: engagement } = useSourceEngagement(onUnauthorized)
  const preferences = usePreferences()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<SourceFilter>('all')
  // Some topics' sources only, in every group (Mes sources, Mes chaînes…): a long list is easier to go through.
  const [topicFilter, setTopicFilter] = useState<string[]>([])
  const phone = useIsPhone()
  // The source whose "⋯" menu is open, on a phone.
  const [moreOf, setMoreOf] = useState<string | null>(null)
  const [adding, setAdding] = useState<AddSourceRequest | null>(null)
  const reader = useReader()
  const requests = useMyRequests(reader.teen)
  const [asking, setAsking] = useState(false)
  const hiddenSources = preferences.hiddenSources
  const actions = useSourceActions({ replace, hiddenSources, adding, setAdding, onUnauthorized })
  const [editing, setEditing] = useState<TopicsEdit | null>(null)
  const opening = useOpenedGroups()

  const list = filterSources({ sources, topics, hiddenSources, engagement, search, filter, topicFilter })
  const groups = groupsOf(list.shown, reader.current, reader.young, t)
  // Browsing everything, each group opens on demand. A filter or a search opens every group it finds.
  const browsing = list.chosen === 'all' && list.chosenTopics.length === 0 && !list.wanted
  const query = browsing ? '' : `${list.chosen}\n${list.chosenTopics.join(' ')}\n${list.wanted}`
  useGroupOpening({
    ...opening,
    loaded: Boolean(sources),
    requestsFirst: reader.teen && Boolean(requests?.length),
    groups,
    query
  })

  const show = (source: SourceStatus, visible: boolean) => {
    const off = list.hidden(source.id)
    opening.setHeld(states => (source.id in states ? states : { ...states, [source.id]: off }))
    updatePreferences({
      hiddenSources: visible ? hiddenSources.filter(other => other !== source.id) : [...hiddenSources, source.id]
    })
  }

  return {
    ...{ sources, failed, search, setSearch, setFilter, setTopicFilter, phone, moreOf, setMoreOf, adding, setAdding },
    ...{ reader, requests, asking, setAsking, actions, editing, setEditing, opening, list, groups, browsing, show }
  }
}

type SourcesPage = ReturnType<typeof useSourcesPage>

// One row per source; on a phone its buttons go in a "⋯" menu.
const rowOf = (page: SourcesPage, topics: TopicInfo[], deletedProfile: string) => (source: SourceStatus) => {
  const { reader, list, actions } = page
  const sourceTopics = list.topicsOf(source.id)
  const mine = reader.admin || (source.addedBy !== undefined && source.addedBy === reader.current)
  const off = list.hidden(source.id)
  const addedBy =
    source.addedBy === undefined || source.addedBy === reader.current
      ? null
      : (reader.nameOf(source.addedBy) ?? deletedProfile)
  const replace =
    list.lowOf(source.id) && !reader.young
      ? () => page.setAdding({ topicId: sourceTopics[0]?.id ?? null, replacing: { id: source.id, name: source.name } })
      : null
  const retopic =
    mine && source.kind === 'article' && sourceTopics.length > 0
      ? () => page.setEditing({ id: source.id, name: source.name, topicIds: sourceTopics.map(topic => topic.id) })
      : null
  return (
    <SourceRow
      key={source.id}
      source={source}
      phone={page.phone}
      off={off}
      addedBy={addedBy}
      replace={replace}
      retopic={retopic}
      deletable={mine && source.addedBy !== undefined}
      removing={actions.removing === source.id}
      onRemove={() => actions.remove(source)}
      open={page.moreOf === source.id}
      onMore={open => page.setMoreOf(open ? source.id : null)}
      onShow={visible => page.show(source, visible)}
    />
  )
}

// The list itself, or why there is none: still loading, failed, or nothing matches.
const SourceList = ({ page, topics }: { page: SourcesPage; topics: TopicInfo[] }) => {
  const { t } = useTranslation()
  const { list, opening, reader } = page
  if (page.failed) return <StatusLine tone="error">{t('sources.loadFailed')}</StatusLine>
  if (!page.sources) return <RowsSkeleton rows={4} lead="none" hint={false} end="round" />
  if (list.shown.length === 0 && !page.browsing) return <StatusLine tone="info">{t('sources.noMatch')}</StatusLine>
  const placedOff = (id: string) => opening.held[id] ?? list.hidden(id)
  const row = rowOf(page, topics, t('sources.deletedProfile'))
  return (
    <AccordionGroup>
      {reader.teen && page.browsing && (
        <RequestsAccordion
          requests={page.requests}
          open={opening.opened.includes('requests')}
          onToggle={() => opening.toggle('requests')}
        />
      )}
      {page.groups.map(
        group =>
          group.sources.length > 0 && (
            <GroupAccordion
              key={group.id}
              group={group}
              young={reader.young}
              sections={sectionsOf(group.sources, { topics, chosenTopics: list.chosenTopics, placedOff, t })}
              open={opening.opened.includes(group.id)}
              onToggle={() => opening.toggle(group.id)}
              onHideLow={list.chosen === 'low' ? () => page.actions.hideLow(group.sources) : null}
              row={row}
            />
          )
      )}
    </AccordionGroup>
  )
}

// Under the list, as Profils and Plugins add theirs: beside the search it read as "add what I typed".
const AddButton = ({ page }: { page: SourcesPage }) => {
  const { t } = useTranslation()
  if (page.reader.young) {
    if (!page.reader.teen) return null
    return (
      <Button icon={Plus} onClick={() => page.setAsking(true)} data-tour="ask-source">
        {t('requests.ask')}
      </Button>
    )
  }
  return (
    <Button
      icon={Plus}
      data-tour="add-source"
      onClick={() => page.setAdding({ topicId: page.list.chosenTopics[0] ?? null, replacing: null })}
    >
      {t('settings.addSource.title')}
    </Button>
  )
}

// Every feed as a row, in folding groups: the profile's own sites and channels, the household's, the base ones. One
// button under the list adds a source (by link or with the AI); beside the search, the filters find the little-read,
// the failing and the hidden ones, and a topic's.
const SourcesSection = ({ topics, layout, onUnauthorized }: SourcesSectionProps) => {
  const { t } = useTranslation()
  const page = useSourcesPage(topics, onUnauthorized)
  const { list, reader } = page

  return (
    <SectionPage
      title={t('settings.nav.sources')}
      intro={t(reader.young ? 'requests.intro' : 'sources.intro')}
      layout={layout}
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

      <SourceList page={page} topics={topics} />

      {(!reader.young || reader.teen) && (
        <div className={sourceStyles.addLine}>
          <AddButton page={page} />
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
