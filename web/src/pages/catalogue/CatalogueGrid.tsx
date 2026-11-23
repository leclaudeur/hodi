import { ArrowUpDown, ExternalLink, LibraryBig, Minus, Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TopicSummary } from '../../api.ts'
import { CATALOGUE_SORTS, type CatalogueEntry, type CatalogueSort } from '../../lib/catalogue.ts'
import { cardTopicOf } from '../../lib/source-card.ts'
import Button from '../../ui/Button.tsx'
import EmptyState from '../../ui/EmptyState.tsx'
import Menu, { MenuItem } from '../../ui/Menu.tsx'
import RoundButton from '../../ui/RoundButton.tsx'
import SourceCard from '../../ui/SourceCard.tsx'
import SourceReaders from '../../ui/SourceReaders.tsx'
import cardStyles from '../../ui/SourceCard.module.css'
import StatusLine from '../../ui/StatusLine.tsx'
import RowsSkeleton from '../../views/settings/SettingsSkeleton.tsx'
import ReportSourceButton from '../../views/settings/sections/ReportSourceButton.tsx'
import styles from './Catalogue.module.css'

// Alphabétique or Plus populaires, each either way, in a menu beside the search.
export const SortMenu = ({ value, onChange }: { value: CatalogueSort; onChange: (sort: CatalogueSort) => void }) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <span className={styles.sort}>
      <Button
        icon={ArrowUpDown}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('catalogue.sort.label', { sort: t(`catalogue.sort.${value}`) })}
        onClick={() => setOpen(!open)}
      >
        {t(`catalogue.sort.${value}`)}
      </Button>
      <Menu open={open} onClose={() => setOpen(false)} label={t('catalogue.sort.title')} align="end">
        {CATALOGUE_SORTS.map(sort => (
          <MenuItem
            key={sort}
            checked={sort === value}
            onClick={() => {
              setOpen(false)
              onChange(sort)
            }}
          >
            {t(`catalogue.sort.${sort}`)}
          </MenuItem>
        ))}
      </Menu>
    </span>
  )
}

interface CardProps {
  entry: CatalogueEntry
  topics: TopicSummary[]
  current: string
  busy: boolean
  onAdd: () => void
  onRemove: () => void
}

// A source of the catalogue: its readers in the corner; once in « Mes sources », it stays in place, its border in the
// accent and Retirer in its footer.
const CatalogueCard = ({ entry, topics, current, busy, onAdd, onRemove }: CardProps) => {
  const { t } = useTranslation()
  const { topic, moreTopics } = cardTopicOf(
    entry.topicIds.flatMap(id => topics.filter(candidate => candidate.id === id)),
    [current]
  )
  return (
    <SourceCard
      sourceId={entry.id}
      name={entry.name}
      topic={topic}
      moreTopics={moreTopics}
      corner={<SourceReaders readers={entry.readers} />}
      picked={entry.mine}
      start={
        entry.mine ? (
          <Button
            compact
            look="danger"
            icon={Minus}
            aria-label={t('catalogue.remove', { name: entry.name })}
            onClick={onRemove}
          >
            {t('sourceCard.remove')}
          </Button>
        ) : (
          <Button
            compact
            look="primary"
            icon={Plus}
            busy={busy}
            aria-label={t('catalogue.add', { name: entry.name })}
            onClick={onAdd}
          >
            {t('sourceCard.add')}
          </Button>
        )
      }
      end={
        <>
          {/* A source sources.yml offers and nobody added yet is not on the server: nothing to report. */}
          {!entry.proposal && <ReportSourceButton source={entry} />}
          <RoundButton
            size={34}
            icon={ExternalLink}
            label={t('addSource.seeSite', { name: entry.name })}
            title={t('catalogue.openSite')}
            href={entry.site}
            external
          />
        </>
      }
    />
  )
}

interface GridProps {
  entries: CatalogueEntry[] | null
  topics: TopicSummary[]
  current: string
  failed: boolean
  busy: string | null
  onAdd: (entry: CatalogueEntry) => void
  onRemove: (entry: CatalogueEntry) => void
}

const CatalogueGrid = ({ entries, topics, current, failed, busy, onAdd, onRemove }: GridProps) => {
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
    <div className={styles.results}>
      <ul className={cardStyles.grid} data-tour="catalogue-grid">
        {entries.map(entry => (
          <CatalogueCard
            key={entry.id}
            entry={entry}
            topics={topics}
            current={current}
            busy={busy === entry.id}
            onAdd={() => onAdd(entry)}
            onRemove={() => onRemove(entry)}
          />
        ))}
      </ul>
    </div>
  )
}

export default CatalogueGrid
