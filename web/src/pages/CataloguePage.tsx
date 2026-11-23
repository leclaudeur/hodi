import { ListTree, Search } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TopicSummary } from '../api.ts'
import { type CatalogueSort, entriesOf, partsOf } from '../lib/catalogue.ts'
import { getLanguage } from '../lib/i18n.ts'
import { isYoung, useProfiles } from '../lib/profiles.ts'
import { catalogueHref, settingsHref, useHashRoute } from '../lib/use-hash-route.ts'
import Button from '../ui/Button.tsx'
import Copyright from '../ui/Copyright.tsx'
import Menu, { MenuItem } from '../ui/Menu.tsx'
import TextField from '../ui/TextField.tsx'
import { rich } from '../ui/rich.tsx'
import TopicIcon from '../ui/TopicIcon.tsx'
import { Header } from './AccountPage.tsx'
import gridStyles from './catalogue/Catalogue.module.css'
import CatalogueGrid, { SortMenu } from './catalogue/CatalogueGrid.tsx'
import { useCatalogue } from './catalogue/use-catalogue.ts'
import styles from './AccountPage.module.css'

// The catalogue's topics in its sidebar, each in its colours.
const Side = ({ parts, current }: { parts: TopicSummary[]; current: string }) => {
  const { t } = useTranslation()
  return (
    <nav className={styles.side} aria-label={t('catalogue.title')}>
      <span className={styles.group}>{t('catalogue.title')}</span>
      {parts.map(topic => (
        <a key={topic.id} href={catalogueHref(topic.id)} aria-current={topic.id === current ? 'page' : undefined}>
          <span className={`${styles.sq} ${styles.topicSq}`} data-topic={topic.id}>
            <TopicIcon topicId={topic.id} size={14} />
          </span>
          {topic.label}
        </a>
      ))}
    </nav>
  )
}

// Phone and tablet: the parts in a menu under the header, as Mon compte's.
const Crumb = ({ parts, current }: { parts: TopicSummary[]; current: string }) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const go = (id: string) => {
    setOpen(false)
    window.location.assign(catalogueHref(id))
  }
  return (
    <div className={styles.crumb}>
      <span className={styles.group}>{t('catalogue.title')}</span>
      <span className={styles.sections}>
        <Button compact icon={ListTree} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
          {t('catalogue.parts')}
        </Button>
        <Menu open={open} onClose={() => setOpen(false)} label={t('catalogue.parts')} align="end">
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

// The server's sources, a page apart as Mon compte: the topics in its sidebar, each a grid of cards, sorted and
// searched apart; Ajouter puts one in « Mes sources ». A teen or a child has its parents choose: it goes back to its sources.
const CataloguePage = () => {
  const { t } = useTranslation()
  const route = useHashRoute()
  const onUnauthorized = useCallback(() => window.location.replace('/'), [])
  const catalogue = useCatalogue(onUnauthorized)
  const household = useProfiles({ onError: () => {} })
  const me = household?.profiles.find(profile => profile.id === household.current)
  const young = me ? isYoung(me) : false
  // Each topic its own search: a word typed in one does not empty the next.
  const [searches, setSearches] = useState<Record<string, string>>({})
  const [sort, setSort] = useState<CatalogueSort>('az')
  useEffect(() => {
    if (young) window.location.replace(settingsHref('sources'))
  }, [young])

  const parts = catalogue.entries ? partsOf(catalogue.entries, catalogue.topics) : []
  const asked = route.name === 'catalogue' ? route.part : null
  const current = parts.find(topic => topic.id === asked)?.id ?? parts[0]?.id ?? ''
  const search = searches[current] ?? ''
  const label = parts.find(topic => topic.id === current)?.label ?? ''
  const shown =
    catalogue.entries && entriesOf(catalogue.entries, { topicId: current, language: getLanguage(), search, sort })

  return (
    <div className={styles.page}>
      <Header back={settingsHref('sources')} />
      <div className={styles.frame}>
        <div className={styles.view}>
          <div className={styles.wrap}>
            <Side parts={parts} current={current} />
            <main className={`${styles.main} ${gridStyles.wide}`}>
              <Crumb parts={parts} current={current} />
              <div className={styles.head}>
                <span className={styles.kicker}>{t('catalogue.title')}</span>
                <h1 className={styles.title}>
                  {label}
                  <span className={styles.dot} aria-hidden="true" />
                </h1>
              </div>
              <p className={styles.intro}>{rich(t('catalogue.intro'))}</p>
              <div className={gridStyles.toolbar}>
                <TextField
                  icon={Search}
                  type="search"
                  value={search}
                  onChange={event => setSearches({ ...searches, [current]: event.target.value })}
                  placeholder={t('catalogue.searchIn', { topic: label })}
                  aria-label={t('catalogue.searchIn', { topic: label })}
                />
                <SortMenu value={sort} onChange={setSort} />
              </div>
              <CatalogueGrid
                entries={shown}
                topics={parts}
                current={current}
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
