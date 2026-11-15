import { X } from 'lucide-react'
import { type CSSProperties, type KeyboardEvent, type Ref, useId, useState } from 'react'
import { useFloatingPanel } from '../../../lib/floating.ts'
import { useTranslation } from 'react-i18next'
import type { TopicSummary } from '../../../api.ts'
import { foldText } from '../../../../../shared/word-match.ts'
import TopicIcon from '../../../ui/TopicIcon.tsx'
import styles from './TopicField.module.css'

// As many as the server takes for one source.
export const MAX_SOURCE_TOPICS = 8

interface TopicFieldProps {
  topics: TopicSummary[]
  selected: string[]
  onChange: (ids: string[]) => void
  label: string
}

// The field's typing, the topics it offers and the one the arrow keys are on.
const useTopicCombobox = ({ topics, selected, onChange }: Omit<TopicFieldProps, 'label'>) => {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listId = useId()

  const full = selected.length >= MAX_SOURCE_TOPICS
  const offered = full
    ? []
    : topics.filter(topic => !selected.includes(topic.id) && foldText(topic.label).includes(foldText(query.trim())))
  const shown = open && offered.length > 0
  const { attach, style: floatingStyle } = useFloatingPanel(shown, { stretch: true, maxHeight: 248 })

  const pick = (id: string) => {
    onChange([...selected, id])
    setQuery('')
    setActive(0)
  }

  const handleKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive(index => (offered.length ? (index + step + offered.length) % offered.length : 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const topic = offered[active] ?? offered[0]
      if (shown && topic) pick(topic.id)
    } else if (event.key === 'Escape' && shown) {
      event.preventDefault()
      setOpen(false)
    } else if (event.key === 'Backspace' && query === '' && selected.length > 0) {
      onChange(selected.slice(0, -1))
    }
  }

  const type = (value: string) => {
    setQuery(value)
    setActive(0)
    setOpen(true)
  }

  return { query, type, setOpen, active, listId, full, offered, shown, attach, floatingStyle, pick, handleKey }
}

interface TopicOptionsProps {
  offered: TopicSummary[]
  active: number
  listId: string
  label: string
  attach: Ref<HTMLUListElement>
  style: CSSProperties
  pick: (id: string) => void
}

// The topics offered for what is typed, under the field.
const TopicOptions = ({ offered, active, listId, label, attach, style, pick }: TopicOptionsProps) => {
  return (
    <ul
      ref={attach}
      popover="manual"
      style={style}
      id={listId}
      role="listbox"
      className={styles.options}
      aria-label={label}
    >
      {offered.map((topic, index) => (
        <li
          key={topic.id}
          id={`${listId}-${topic.id}`}
          role="option"
          aria-selected={index === active}
          className={styles.option}
          data-topic={topic.id}
          // Before the field's blur closes the list.
          onMouseDown={event => event.preventDefault()}
          onClick={() => pick(topic.id)}
        >
          <span className={styles.optionIcon}>
            <TopicIcon topicId={topic.id} size={14} />
          </span>
          {topic.label}
        </li>
      ))}
    </ul>
  )
}

// A source's topics, as tags: the chosen ones in their colours (a tap takes one back), then a field
// that offers the others as you type. Enter takes the first offered, Backspace in the empty field the last tag.
const TopicField = ({ topics, selected, onChange, label }: TopicFieldProps) => {
  const { t } = useTranslation()
  const combobox = useTopicCombobox({ topics, selected, onChange })
  const { listId, shown, offered, active, attach, floatingStyle, pick } = combobox
  const chosen = selected.flatMap(id => topics.filter(topic => topic.id === id))

  return (
    <div className={styles.wrap}>
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
        {!combobox.full && (
          <input
            type="text"
            role="combobox"
            aria-label={label}
            aria-expanded={shown}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={shown ? `${listId}-${offered[active]?.id}` : undefined}
            value={combobox.query}
            placeholder={t(selected.length ? 'addSource.anotherTopic' : 'addSource.typeTopic')}
            onChange={event => combobox.type(event.target.value)}
            onFocus={() => combobox.setOpen(true)}
            // Long enough for a tap on an offered topic to land first.
            onBlur={() => window.setTimeout(() => combobox.setOpen(false), 150)}
            onKeyDown={combobox.handleKey}
            autoComplete="off"
            maxLength={40}
          />
        )}
      </div>
      {shown && (
        <TopicOptions
          offered={offered}
          active={active}
          listId={listId}
          label={label}
          attach={attach}
          style={floatingStyle}
          pick={pick}
        />
      )}
    </div>
  )
}

export default TopicField
