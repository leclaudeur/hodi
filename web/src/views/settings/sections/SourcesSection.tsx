import { ArrowLeftRight, EyeOff, ExternalLink, MoreHorizontal, Plus, Search, Tags, Trash2 } from 'lucide-react'
import { type MouseEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  type SourceStatus,
  TOPICS_CHANGED,
  type TopicInfo,
  UnauthorizedError,
  getSources,
  removeSource,
  setSourceTopics
} from '../../../api.ts'
import { askToConfirm } from '../../../lib/confirm.ts'
import { shortAgo } from '../../../lib/format.ts'
import { getLanguage } from '../../../lib/i18n.ts'
import { updatePreferences, usePreferences } from '../../../lib/preferences.ts'
import { useMyRequests } from '../../../lib/my-requests.ts'
import { isYoung, useProfiles } from '../../../lib/profiles.ts'
import { sourceState, useSourceEngagement, useSourceStatuses } from '../../../lib/settings-data.ts'
import { showError, showSaved } from '../../../lib/toast.ts'
import { useTourStep } from '../../../lib/tour.ts'
import { useIsPhone } from '../../../lib/use-media.ts'
import { foldText } from '../../../lib/word-match.ts'
import Accordion, { AccordionGroup } from '../../../ui/Accordion.tsx'
import Button from '../../../ui/Button.tsx'
import Chip from '../../../ui/Chip.tsx'
import DaySeparator from '../../../ui/DaySeparator.tsx'
import Dialog from '../../../ui/Dialog.tsx'
import DialogActions from '../../../ui/DialogActions.tsx'
import Menu, { MenuItem } from '../../../ui/Menu.tsx'
import RoundButton from '../../../ui/RoundButton.tsx'
import SourceAvatar from '../../../ui/SourceAvatar.tsx'
import StatusLine from '../../../ui/StatusLine.tsx'
import TextField from '../../../ui/TextField.tsx'
import Toggle from '../../../ui/Toggle.tsx'
import RichText from '../../../ui/RichText.tsx'
import SectionPage from '../SectionPage.tsx'
import RowsSkeleton from '../SettingsSkeleton.tsx'
import styles from '../Settings.module.css'
import AddSourceDialog, { type AddSourceRequest } from './AddSourceDialog.tsx'
import AskSourceDialog from './AskSourceDialog.tsx'
import sourceStyles from './SourcesSection.module.css'
import { type SourceFilter, StatusSelect, TopicFilter } from './SourceFilters.tsx'
import TopicField from './TopicField.tsx'

type GroupId = 'requests' | 'mine' | 'channels' | 'household' | 'base'

// A source's site as its row's line: "lejde.be".
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

interface SourcesSectionProps {
  topics: TopicInfo[]
  layout: 'desktop' | 'phone'
  onUnauthorized: () => void
}

// Every feed as a row, in folding groups: the profile's own sites and channels, the household's, the base ones. One
// button beside the search adds a source (by link or with the AI); the filters find the little-read, the failing and
// the hidden ones, and a topic's.
const SourcesSection = ({ topics, layout, onUnauthorized }: SourcesSectionProps) => {
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
  const household = useProfiles({ onError: () => {} })
  const current = household?.current
  const me = household?.profiles.find(profile => profile.id === current)
  const admin = me?.role === 'admin'
  // A young profile reads the sources its parents gave it: it adds, changes and removes none. A teen asks for one.
  const young = me ? isYoung(me) : false
  const teen = me?.kind === 'teen'
  const requests = useMyRequests(teen)
  const [asking, setAsking] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  // The source whose topics are being changed, and the ones picked so far.
  const [editing, setEditing] = useState<{ id: string; name: string; topicIds: string[] } | null>(null)
  const [saving, setSaving] = useState(false)
  // The first group open as the page opens, the others closed: their titles and counts are the page's summary, and
  // a long group scrolls inside its card. During the tour, the sites stay open.
  const touring = useTourStep() !== null
  const [opened, setOpened] = useState<GroupId[]>(touring ? ['mine'] : [])
  // The sources shown or hidden since the page or an accordion opened, with their state before: they keep their
  // place until then, so a card does not jump away from the toggle just used.
  const [held, setHeld] = useState<Record<string, boolean>>({})
  const toggle = (id: GroupId) => {
    if (!opened.includes(id)) setHeld({})
    setOpened(ids => (ids.includes(id) ? ids.filter(other => other !== id) : [...ids, id]))
  }

  const reload = () =>
    getSources()
      .then(replace)
      .catch((error: unknown) => {
        if (error instanceof UnauthorizedError) onUnauthorized()
      })

  const remove = ({ id, name }: SourceStatus) =>
    askToConfirm({
      title: t('confirm.deleteSource.title'),
      message: <RichText i18nKey="confirm.deleteSource.message" values={{ name }} />,
      label: t('confirm.deleteSource.button'),
      onConfirm: () => {
        setRemoving(id)
        void removeSource(id)
          .then(async () => {
            window.dispatchEvent(new Event(TOPICS_CHANGED))
            await reload()
            showSaved(t('sources.deleted', { name }))
          })
          .catch((error: unknown) => {
            if (error instanceof UnauthorizedError) onUnauthorized()
            else showError(t('sources.deleteFailed'))
          })
          .finally(() => setRemoving(null))
      }
    })

  // "Peu ouvertes": hides a group's ones at once, after a question.
  const hideLow = (list: SourceStatus[]) =>
    askToConfirm({
      ...(list.length > 1
        ? {
            title: t('confirm.hideSources.title', { count: list.length }),
            message: <RichText i18nKey="confirm.hideSources.message" values={{ count: list.length }} />,
            label: t('confirm.hideSources.button', { count: list.length })
          }
        : {
            title: t('confirm.hideSource.title'),
            message: <RichText i18nKey="confirm.hideSource.message" values={{ name: list[0]?.name ?? '' }} />,
            label: t('confirm.hideSource.button')
          }),
      onConfirm: () => {
        updatePreferences({
          hiddenSources: [...new Set([...preferences.hiddenSources, ...list.map(source => source.id)])]
        })
        showSaved(t('sources.hidden', { count: list.length }))
      }
    })

  const added = () => {
    // A replacement: the little-read source steps aside for the new one.
    if (adding?.replacing) {
      updatePreferences({ hiddenSources: [...preferences.hiddenSources, adding.replacing.id] }, { quiet: true })
      showSaved(t('sources.replaced', { name: adding.replacing.name }))
      setAdding(null)
    } else {
      showSaved(t('sources.added'))
    }
    void reload()
  }

  const topicsOf = (sourceId: string) => topics.filter(topic => topic.sources.some(source => source.id === sourceId))

  const saveTopics = () => {
    if (!editing || editing.topicIds.length === 0) return
    setSaving(true)
    setSourceTopics(editing.id, editing.topicIds)
      .then(() => {
        window.dispatchEvent(new Event(TOPICS_CHANGED))
        setEditing(null)
        showSaved(t('sources.topicsSaved'))
      })
      .catch((error: unknown) => {
        if (error instanceof UnauthorizedError) onUnauthorized()
        else showError(t('sources.topicsFailed'))
      })
      .finally(() => setSaving(false))
  }
  const hidden = (id: string) => preferences.hiddenSources.includes(id)
  const lowOf = (id: string) => {
    const row = engagement?.sources.find(candidate => candidate.id === id)
    return row?.low && !hidden(id) ? row : null
  }
  const matches: Record<SourceFilter, (source: SourceStatus) => boolean> = {
    all: () => true,
    low: source => lowOf(source.id) !== null,
    error: source => sourceState(source) === 'error' && !hidden(source.id),
    hidden: source => hidden(source.id)
  }
  const counts = sources && {
    all: sources.length,
    low: sources.filter(matches.low).length,
    error: sources.filter(matches.error).length,
    hidden: sources.filter(matches.hidden).length
  }
  const chosen = filter !== 'all' && counts?.[filter] === 0 ? 'all' : filter
  // The topics with at least one source, in the topics' order.
  const filterTopics = topics.filter(topic => topic.sources.length > 0)
  const chosenTopics = topicFilter.filter(id => filterTopics.some(topic => topic.id === id))
  const wanted = foldText(search.trim())
  const shown = (sources ?? []).filter(
    source =>
      matches[chosen](source) &&
      (chosenTopics.length === 0 || topicsOf(source.id).some(topic => chosenTopics.includes(topic.id))) &&
      (!wanted ||
        foldText(
          `${source.name} ${topicsOf(source.id)
            .map(topic => topic.label)
            .join(' ')}`
        ).includes(wanted))
  )
  // A group's sources under a separator per topic, as Le fil's days: each under its first topic (the first filtered
  // on, if any), in the topics' order, then those without one (channels) by kind, by name with the hidden ones last.
  const byTopic = (list: SourceStatus[]) => {
    const sections: { id: string; label: string; sources: SourceStatus[] }[] = []
    for (const source of list) {
      const tagged = topicsOf(source.id)
      const topic = tagged.find(candidate => chosenTopics.includes(candidate.id)) ?? tagged[0]
      const id = topic?.id ?? source.kind
      const section = sections.find(candidate => candidate.id === id)
      if (section) section.sources.push(source)
      else sections.push({ id, label: topic?.label ?? t(`sources.kinds.${source.kind}`), sources: [source] })
    }
    const rank = (id: string) => {
      const index = topics.findIndex(topic => topic.id === id)
      return index === -1 ? topics.length : index
    }
    sections.sort((a, b) => rank(a.id) - rank(b.id))
    const placedOff = (id: string) => held[id] ?? hidden(id)
    sections.forEach(section =>
      section.sources.sort(
        (a, b) => Number(placedOff(a.id)) - Number(placedOff(b.id)) || a.name.localeCompare(b.name, getLanguage())
      )
    )
    return sections
  }
  const own = (source: SourceStatus) => source.addedBy !== undefined && source.addedBy === current
  const groups: { id: GroupId; title: string; sources: SourceStatus[] }[] = [
    {
      id: 'mine',
      title: t('sources.groups.mine'),
      sources: shown.filter(source => own(source) && source.kind === 'article')
    },
    {
      id: 'channels',
      title: t('sources.groups.channels'),
      sources: shown.filter(source => own(source) && source.kind !== 'article')
    },
    {
      id: 'household',
      title: young ? t('requests.byParents') : t('sources.groups.household'),
      sources: shown.filter(source => source.addedBy !== undefined && source.addedBy !== current)
    },
    { id: 'base', title: t('sources.groups.base'), sources: shown.filter(source => source.addedBy === undefined) }
  ]
  // Once the sources are in, the first group shown opens: a teen's requests when it has some, else its first
  // non-empty group.
  const [firstOpened, setFirstOpened] = useState(touring)
  if (!firstOpened && sources) {
    setFirstOpened(true)
    const first = teen && requests?.length ? 'requests' : groups.find(group => group.sources.length > 0)?.id
    if (first) setOpened(ids => (ids.includes(first) ? ids : [...ids, first]))
  }

  // Browsing everything, each group opens on demand. A filter or a search opens every group it finds.
  const browsing = chosen === 'all' && chosenTopics.length === 0 && !wanted
  // A new filter or search opens every group once; each can be closed after. Back to everything, the groups
  // open before come back.
  const query = browsing ? '' : `${chosen}\n${chosenTopics.join(' ')}\n${wanted}`
  const [openedFor, setOpenedFor] = useState({ query, before: opened })
  if (openedFor.query !== query) {
    setOpenedFor({ query, before: openedFor.query ? openedFor.before : opened })
    setOpened(query ? ['mine', 'channels', 'household', 'base'] : openedFor.before)
  }

  // Beside the search, as tall as it; on a phone, a round one.
  const addButton = young ? (
    teen &&
    (phone ? (
      <RoundButton
        icon={Plus}
        label={t('requests.ask')}
        variant="primary"
        size={44}
        onClick={() => setAsking(true)}
        data-tour="ask-source"
      />
    ) : (
      <Button look="primary" icon={Plus} onClick={() => setAsking(true)} data-tour="ask-source">
        {t('requests.ask')}
      </Button>
    ))
  ) : phone ? (
    <RoundButton
      icon={Plus}
      label={t('settings.addSource.title')}
      variant="primary"
      size={44}
      data-tour="add-source"
      onClick={() => setAdding({ topicId: chosenTopics[0] ?? null, replacing: null })}
    />
  ) : (
    <Button
      look="primary"
      icon={Plus}
      data-tour="add-source"
      onClick={() => setAdding({ topicId: chosenTopics[0] ?? null, replacing: null })}
    >
      {t('settings.addSource.title')}
    </Button>
  )

  const show = (source: SourceStatus, visible: boolean) => {
    const off = hidden(source.id)
    setHeld(states => (source.id in states ? states : { ...states, [source.id]: off }))
    updatePreferences({
      hiddenSources: visible
        ? preferences.hiddenSources.filter(other => other !== source.id)
        : [...preferences.hiddenSources, source.id]
    })
  }

  // One row per source, as Réglages' other lists: its avatar, its name over its site, its buttons and its switch.
  // The whole row shows or hides it; on a phone its buttons go in a "⋯" menu.
  const row = (source: SourceStatus) => {
    const state = sourceState(source)
    const sourceTopics = topicsOf(source.id)
    const mine = admin || (source.addedBy !== undefined && source.addedBy === current)
    const off = hidden(source.id)
    const low = lowOf(source.id)
    const ago = shortAgo(source.fetchedAt)
    const error = state === 'error' && !off
    const errorText = `${t('sources.status.error')}${ago ? ` · ${ago}` : ''}`
    const addedBy =
      source.addedBy === undefined || source.addedBy === current
        ? null
        : (household?.profiles.find(profile => profile.id === source.addedBy)?.name ?? t('sources.deletedProfile'))
    const site = hostOf(source.site)
    const hint = [
      phone && error ? t('sources.status.error') : null,
      site,
      addedBy && t('sources.by', { name: addedBy })
    ]
      .filter(Boolean)
      .join(' · ')
    const replace =
      low && !young
        ? () => setAdding({ topicId: sourceTopics[0]?.id ?? null, replacing: { id: source.id, name: source.name } })
        : null
    const retopic =
      mine && source.kind === 'article' && sourceTopics.length > 0
        ? () => setEditing({ id: source.id, name: source.name, topicIds: sourceTopics.map(topic => topic.id) })
        : null
    const deletable = mine && source.addedBy !== undefined
    // A click on the row, not on one of its buttons, flips its switch.
    const flip = (event: MouseEvent) => {
      if ((event.target as HTMLElement).closest('button, a, [role="menu"]')) return
      show(source, off)
    }

    return (
      <li key={source.id} className={sourceStyles.row} onClick={flip}>
        <span className={`${sourceStyles.avatar} ${off ? styles.dim : ''}`}>
          <SourceAvatar sourceId={source.id} sourceName={source.name} size={44} />
        </span>
        <span className={`${styles.rowText} ${off ? styles.dim : ''}`}>
          <span className={`${styles.rowLabel} ${sourceStyles.name}`}>{source.name}</span>
          <span
            className={`${styles.rowHint} ${sourceStyles.name} ${phone && error ? sourceStyles.errorHint : ''}`}
            title={error && source.error ? t('sources.errorTitle', { error: source.error }) : undefined}
          >
            {hint}
          </span>
        </span>
        {!phone && error && (
          <Chip
            tone="warning"
            size="row"
            title={source.error ? t('sources.errorTitle', { error: source.error }) : undefined}
          >
            {errorText}
          </Chip>
        )}
        <span className={sourceStyles.actions}>
          {phone ? (
            <span className={sourceStyles.more}>
              <RoundButton
                icon={MoreHorizontal}
                label={t('sources.moreFor', { name: source.name })}
                aria-haspopup="menu"
                aria-expanded={moreOf === source.id}
                onClick={() => setMoreOf(moreOf === source.id ? null : source.id)}
              />
              <Menu
                open={moreOf === source.id}
                onClose={() => setMoreOf(null)}
                label={t('sources.moreFor', { name: source.name })}
                align="end"
              >
                {replace && (
                  <MenuItem
                    icon={ArrowLeftRight}
                    onClick={() => {
                      setMoreOf(null)
                      replace()
                    }}
                  >
                    {t('sources.replace')}
                  </MenuItem>
                )}
                {retopic && (
                  <MenuItem
                    icon={Tags}
                    onClick={() => {
                      setMoreOf(null)
                      retopic()
                    }}
                  >
                    {t('sources.changeTopics')}
                  </MenuItem>
                )}
                <MenuItem icon={ExternalLink} href={source.site} label={t('addSource.seeSite', { name: source.name })}>
                  {t('sources.seeSite')}
                </MenuItem>
                {deletable && (
                  <MenuItem
                    icon={Trash2}
                    tone="danger"
                    disabled={removing === source.id}
                    onClick={() => {
                      setMoreOf(null)
                      remove(source)
                    }}
                  >
                    {t('sources.delete')}
                  </MenuItem>
                )}
              </Menu>
            </span>
          ) : (
            <>
              {replace && (
                <RoundButton
                  icon={ArrowLeftRight}
                  label={t('settings.addSource.replace', { name: source.name })}
                  title={t('settings.addSource.replace', { name: source.name })}
                  onClick={replace}
                />
              )}
              {retopic && (
                <RoundButton
                  icon={Tags}
                  label={t('sources.changeTopicsOf', { name: source.name })}
                  title={t('sources.changeTopics')}
                  onClick={retopic}
                />
              )}
              <RoundButton
                icon={ExternalLink}
                label={t('addSource.seeSite', { name: source.name })}
                title={t('sources.seeSite')}
                href={source.site}
                external
              />
              {deletable && (
                <RoundButton
                  icon={Trash2}
                  variant="danger"
                  label={t('sources.deleteFor', { name: source.name })}
                  title={t('profileForm.delete')}
                  disabled={removing === source.id}
                  onClick={() => remove(source)}
                />
              )}
            </>
          )}
          <Toggle
            label={t('settings.themes.show', { name: source.name })}
            checked={!off}
            onChange={visible => show(source, visible)}
          />
        </span>
      </li>
    )
  }

  return (
    <SectionPage
      title={t('settings.nav.sources')}
      intro={t(young ? 'requests.intro' : 'sources.intro')}
      layout={layout}
    >
      <div className={sourceStyles.searchLine}>
        <TextField
          icon={Search}
          type="search"
          value={search}
          onChange={event => setSearch(event.target.value)}
          placeholder={t('sources.search')}
          aria-label={t('sources.searchLabel')}
        />
        {addButton}
      </div>

      {counts && (
        <div className={sourceStyles.filters}>
          <StatusSelect value={chosen} counts={counts} onChange={setFilter} />
          {filterTopics.length > 1 && (
            <TopicFilter topics={filterTopics} selected={chosenTopics} onChange={setTopicFilter} />
          )}
        </div>
      )}

      {failed ? (
        <StatusLine tone="error">{t('sources.loadFailed')}</StatusLine>
      ) : !sources ? (
        <RowsSkeleton rows={4} lead="none" hint={false} end="round" />
      ) : shown.length === 0 && !browsing ? (
        <StatusLine tone="info">{t('sources.noMatch')}</StatusLine>
      ) : (
        <AccordionGroup>
          {/* A teen's requests, waiting for its parents; its intro says what they are while there is none. */}
          {teen && browsing && (
            <Accordion
              title={t('requests.mine')}
              intro={t('sources.groupIntros.requests')}
              count={requests?.length ?? 0}
              tour="requests"
              open={opened.includes('requests')}
              onToggle={() => toggle('requests')}
            >
              <ul className={sourceStyles.list}>
                {(requests ?? []).map(request => (
                  <li key={request.id} className={sourceStyles.row}>
                    <SourceAvatar sourceId="" sourceName={request.source.name} size={44} />
                    <span className={styles.rowText}>
                      <span className={`${styles.rowLabel} ${sourceStyles.name}`}>{request.source.name}</span>
                      <span className={`${styles.rowHint} ${sourceStyles.name}`}>
                        {request.source.domains[0] ?? hostOf(request.source.url)}
                      </span>
                    </span>
                    <Chip tone="warning" size="row" label={t('requests.pendingLabel')}>
                      {t('requests.pending')}
                    </Chip>
                  </li>
                ))}
              </ul>
            </Accordion>
          )}
          {groups.map(
            group =>
              group.sources.length > 0 && (
                <Accordion
                  key={group.id}
                  title={group.title}
                  intro={t(`sources.groupIntros.${young && group.id === 'household' ? 'parents' : group.id}`)}
                  count={group.sources.length}
                  open={opened.includes(group.id)}
                  onToggle={() => toggle(group.id)}
                  action={
                    chosen === 'low' && (
                      <Button look="danger" compact icon={EyeOff} onClick={() => hideLow(group.sources)}>
                        {t('sources.hideAll')}
                      </Button>
                    )
                  }
                >
                  {byTopic(group.sources).map((section, index, sections) => (
                    <div key={section.id} className={sourceStyles.section}>
                      {sections.length > 1 && (
                        <DaySeparator
                          label={section.label}
                          count={section.sources.length}
                          unit="source"
                          first={index === 0}
                          className={sourceStyles.topicSeparator}
                        />
                      )}
                      <ul className={sourceStyles.list}>{section.sources.map(row)}</ul>
                    </div>
                  ))}
                </Accordion>
              )
          )}
        </AccordionGroup>
      )}

      {/* Changing a source's topics happens in a dialog, as every action in Réglages. */}
      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? t('sources.topicsOf', { name: editing.name }) : ''}
        intro={editing && <RichText i18nKey="dialogIntro.sourceTopics" values={{ name: editing.name }} />}
      >
        {editing && (
          <>
            <TopicField
              topics={topics}
              selected={editing.topicIds}
              onChange={topicIds => setEditing({ ...editing, topicIds })}
              label={t('sources.topicsOf', { name: editing.name })}
            />
            <DialogActions>
              <Button onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
              <Button look="primary" busy={saving} disabled={editing.topicIds.length === 0} onClick={saveTopics}>
                {t('common.save')}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      <AskSourceDialog open={asking} onClose={() => setAsking(false)} />

      <AddSourceDialog
        topics={topics}
        request={adding}
        onClose={() => setAdding(null)}
        onAdded={added}
        onUnauthorized={onUnauthorized}
      />
    </SectionPage>
  )
}

export default SourcesSection
