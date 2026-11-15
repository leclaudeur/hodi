import { ChevronDown, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TopicSummary } from '../../../api.ts'
import { useIsPhone } from '../../../lib/use-media.ts'
import Menu, { MenuItem } from '../../../ui/Menu.tsx'
import TopicIcon from '../../../ui/TopicIcon.tsx'
import styles from './SourceFilters.module.css'

export type SourceFilter = 'all' | 'low' | 'error' | 'hidden'

export const SOURCE_FILTERS: SourceFilter[] = ['all', 'low', 'error', 'hidden']

interface StatusSelectProps {
  value: SourceFilter
  counts: Record<SourceFilter, number>
  onChange: (value: SourceFilter) => void
}

// Toutes · Peu ouvertes · En erreur · Masquées, as a select: one capsule, its menu under it. A state with no source
// stays in the list, greyed.
export const StatusSelect = ({ value, counts, onChange }: StatusSelectProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  return (
    <div className={styles.select}>
      <button
        ref={button}
        type="button"
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('sources.filterValue', { value: t(`sources.filters.${value}`) })}
        onClick={() => setOpen(!open)}
      >
        {t(`sources.filters.${value}`)}
        <span className={styles.count}>{counts[value]}</span>
        <ChevronDown size={16} className={styles.chevron} aria-hidden="true" />
      </button>
      <Menu
        open={open}
        onClose={refocus => {
          setOpen(false)
          if (refocus) button.current?.focus()
        }}
        label={t('sources.filter')}
      >
        {SOURCE_FILTERS.map(key => (
          <MenuItem
            key={key}
            checked={key === value}
            count={counts[key]}
            disabled={counts[key] === 0 && key !== value}
            onClick={() => {
              setOpen(false)
              onChange(key)
            }}
          >
            {t(`sources.filters.${key}`)}
          </MenuItem>
        ))}
      </Menu>
    </div>
  )
}

interface TopicFilterProps {
  topics: TopicSummary[]
  selected: string[]
  onChange: (ids: string[]) => void
}

// The topics to show, as tags in one field: the chosen ones in their colours (a tap takes one back), the others in
// its menu. None chosen: every topic.
export const TopicFilter = ({ topics, selected, onChange }: TopicFilterProps) => {
  const { t } = useTranslation()
  const phone = useIsPhone()
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const chosen = selected.flatMap(id => topics.filter(topic => topic.id === id))
  const offered = topics.filter(topic => !selected.includes(topic.id))
  // On a phone the chosen tags take the room; the menu still opens from the rest of the field.
  const placeholder = chosen.length === 0 ? t('sources.allTopics') : phone ? '' : t('addSource.anotherTopic')

  return (
    <div className={styles.topics}>
      <div className={styles.field}>
        {chosen.map(topic => (
          <button
            key={topic.id}
            type="button"
            className={styles.tag}
            data-topic={topic.id}
            aria-label={t('addSource.removeTopic', { name: topic.label })}
            onClick={() => onChange(selected.filter(id => id !== topic.id))}
          >
            <TopicIcon topicId={topic.id} size={14} />
            {topic.label}
            <X size={12} aria-hidden="true" />
          </button>
        ))}
        {offered.length > 0 && (
          <button
            ref={button}
            type="button"
            className={styles.open}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={t('sources.filterTopic')}
            onClick={() => setOpen(!open)}
          >
            <span className={styles.placeholder}>{placeholder}</span>
            <ChevronDown size={16} className={styles.chevron} aria-hidden="true" />
          </button>
        )}
      </div>
      <Menu
        open={open && offered.length > 0}
        onClose={refocus => {
          setOpen(false)
          if (refocus) button.current?.focus()
        }}
        label={t('sources.filterTopic')}
        align="stretch"
      >
        {offered.map(topic => (
          <MenuItem
            key={topic.id}
            lead={
              <span className={styles.icon} data-topic={topic.id}>
                <TopicIcon topicId={topic.id} size={14} />
              </span>
            }
            onClick={() => {
              setOpen(false)
              onChange([...selected, topic.id])
            }}
          >
            {topic.label}
          </MenuItem>
        ))}
      </Menu>
    </div>
  )
}
