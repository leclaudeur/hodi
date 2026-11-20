import { BadgeCheck, LibraryBig, ListTree, Search } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TopicSummary } from '../api.ts'
import { type CatalogueEntry, entriesOf, partsOf } from '../lib/catalogue.ts'
import { getLanguage } from '../lib/i18n.ts'
import { isYoung, useProfiles } from '../lib/profiles.ts'
import { catalogueHref, settingsHref, useHashRoute } from '../lib/use-hash-route.ts'
import Button from '../ui/Button.tsx'
import Copyright from '../ui/Copyright.tsx'
import EmptyState from '../ui/EmptyState.tsx'
import Menu, { MenuItem } from '../ui/Menu.tsx'
import StatusLine from '../ui/StatusLine.tsx'
import TextField from '../ui/TextField.tsx'
import TopicIcon from '../ui/TopicIcon.tsx'
import RowsSkeleton from '../views/settings/SettingsSkeleton.tsx'
import { Header } from './AccountPage.tsx'
import CatalogueCard from './catalogue/CatalogueCard.tsx'
import cardStyles from './catalogue/CatalogueCard.module.css'
import { useCatalogue } from './catalogue/use-catalogue.ts'
import styles from './AccountPage.module.css'

const OFFICIAL = 'official'

// The catalogue's parts in its sidebar: sources.yml's Officielles, then each topic with sources.
const Side = ({ parts, current }: { parts: TopicSummary[]; current: string }) => {
  const { t } = useTranslation()
  const link = (id: string, label: string, icon: ReactNode) => (
    <a key={id} href={catalogueHref(id)} aria-current={id === current ? 'page' : undefined}>
      <span className={styles.sq}>{icon}</span>
      {label}
    </a>
  )
  return (
    <nav className={styles.side} aria-label={t('catalogue.title')}>
      <span className={styles.group}>{t('catalogue.title')}</span>
      {link(OFFICIAL, t('catalogue.official'), <BadgeCheck size={14} aria-hidden="true" />)}
      <span className={`${styles.group} ${styles.subGroup}`}>{t('nav.topics')}</span>
      {parts.map(topic => link(topic.id, topic.label, <TopicIcon topicId={topic.id} size={14} />))}
    </nav>
  )
}

// Phone and tablet: the parts in a menu under the header, as Mon compte's.
const Crumb = ({ parts, current }: { parts: TopicSummary[]; current: string }) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const go = (id: string) => {
    setOpen(false)
    window.location.hash = catalogueHref(id)
  }
  return (
    <div className={styles.crumb}>
      <span className={styles.group}>{t('catalogue.title')}</span>
      <span className={styles.sections}>
        <Button compact icon={ListTree} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
          {t('catalogue.parts')}
        </Button>
        <Menu open={open} onClose={() => setOpen(false)} label={t('catalogue.parts')} align="end">
          <MenuItem icon={BadgeCheck} checked={current === OFFICIAL} onClick={() => go(OFFICIAL)}>
            {t('catalogue.official')}
          </MenuItem>
          {parts.map(topic => (
            <MenuItem
              key={topic.id}
              lead={<TopicIcon topicId={topic.id} size={16} />}
              checked={topic.id === current}
              onClick={() => go(topic.id)}
            >
              {topic.label}
            </MenuItem>
          ))}
        </Menu>
      </span>
    </div>
  )
}

interface ListProps {
  entries: CatalogueEntry[] | null
  failed: boolean
  busy: string | null
  onAdd: (entry: CatalogueEntry) => void
  onRemove: (entry: CatalogueEntry) => void
}

const CatalogueList = ({ entries, failed, busy, onAdd, onRemove }: ListProps) => {
  const { t } = useTranslation()
  if (failed) return <StatusLine tone="error">{t('sources.loadFailed')}</StatusLine>
  if (!entries) return <RowsSkeleton rows={4} end="round" />
  if (entries.length === 0)
    return (
      <EmptyState icon={<LibraryBig size={24} />} title={t('catalogue.empty.title')} compact>
        {t('catalogue.empty.text')}
      </EmptyState>
    )
  return (
    <ul className={cardStyles.grid}>
      {entries.map(entry => (
        <CatalogueCard
          key={entry.id}
          entry={entry}
          busy={busy === entry.id}
          onAdd={() => onAdd(entry)}
          onRemove={() => onRemove(entry)}
        />
      ))}
    </ul>
  )
}

// The server's sources, a page apart as Mon compte: Officielles and the topics in its sidebar, the person's language
// first, + to put one in « Mes sources ». A teen or a child has its parents choose: it goes back to its sources.
const CataloguePage = () => {
  const { t } = useTranslation()
  const route = useHashRoute()
  const onUnauthorized = useCallback(() => window.location.replace('/'), [])
  const catalogue = useCatalogue(onUnauthorized)
  const household = useProfiles({ onError: () => {} })
  const me = household?.profiles.find(profile => profile.id === household.current)
  const young = me ? isYoung(me) : false
  const [search, setSearch] = useState('')
  useEffect(() => {
    if (young) window.location.replace(settingsHref('sources'))
  }, [young])

  const parts = catalogue.entries ? partsOf(catalogue.entries, catalogue.topics) : []
  const asked = route.name === 'catalogue' ? route.part : null
  const current = asked && parts.some(topic => topic.id === asked) ? asked : OFFICIAL
  const label =
    current === OFFICIAL ? t('catalogue.official') : (parts.find(topic => topic.id === current)?.label ?? '')
  const shown = catalogue.entries && entriesOf(catalogue.entries, current, getLanguage(), search)

  return (
    <div className={styles.page}>
      <Header back={settingsHref('sources')} />
      <div className={styles.frame}>
        <div className={styles.view}>
          <div className={styles.wrap}>
            <Side parts={parts} current={current} />
            <main className={styles.main}>
              <Crumb parts={parts} current={current} />
              <div className={styles.head}>
                <span className={styles.kicker}>{t('catalogue.title')}</span>
                <h1 className={styles.title}>
                  {search.trim() ? t('catalogue.searching') : label}
                  <span className={styles.dot} aria-hidden="true" />
                </h1>
              </div>
              <p className={styles.intro}>{t(current === OFFICIAL ? 'catalogue.introOfficial' : 'catalogue.intro')}</p>
              <TextField
                icon={Search}
                type="search"
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder={t('catalogue.search')}
                aria-label={t('catalogue.search')}
              />
              <CatalogueList
                entries={shown}
                failed={catalogue.failed}
                busy={catalogue.busy}
                onAdd={catalogue.add}
                onRemove={catalogue.remove}
              />
            </main>
          </div>
        </div>
        <footer className={styles.foot}>
          <Copyright />
        </footer>
      </div>
    </div>
  )
}

export default CataloguePage
