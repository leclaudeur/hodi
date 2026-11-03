import { X } from 'lucide-react'
import { type KeyboardEvent, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TopicSummary } from '../../../api.ts'
import { foldText } from '../../../lib/word-match.ts'
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

// A source's topics, as tags: the chosen ones in their colours (a tap takes one back), then a field
// that offers the others as you type. Enter takes the first offered, Backspace in the empty field the last tag.
const TopicField = ({ topics, selected, onChange, label }: TopicFieldProps) => {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listId = useId()

  const chosen = selected.flatMap(id => topics.filter(topic => topic.id === id))
  const full = selected.length >= MAX_SOURCE_TOPICS
  const offered = full
    ? []
    : topics.filter(topic => !selected.includes(topic.id) && foldText(topic.label).includes(foldText(query.trim())))
  const shown = open && offered.length > 0

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
        {!full && (
          <input
            type="text"
            role="combobox"
            aria-label={label}
            aria-expanded={shown}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={shown ? `${listId}-${offered[active]?.id}` : undefined}
            value={query}
            placeholder={t(selected.length ? 'addSource.anotherTopic' : 'addSource.typeTopic')}
            onChange={event => {
              setQuery(event.target.value)
              setActive(0)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            // Long enough for a tap on an offered topic to land first.
            onBlur={() => window.setTimeout(() => setOpen(false), 150)}
            onKeyDown={handleKey}
            autoComplete="off"
            maxLength={40}
          />
        )}
      </div>
      {shown && (
        <ul id={listId} role="listbox" className={styles.options} aria-label={label}>
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
      )}
    </div>
  )
}

export default TopicField
