import { X } from 'lucide-react'
import { type CSSProperties, type KeyboardEvent, type ReactNode, type Ref, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { foldText } from '../../../shared/word-match.ts'
import { useFloatingPanel } from '../lib/floating.ts'
import styles from './ChoiceField.module.css'

export interface Choice {
  id: string
  label: string
  // Drawn before the label, in the tag and in the list (a topic's icon).
  icon?: ReactNode
  // A topic's colours, for the tag and the icon's square (data-topic).
  topic?: string
}

export interface ChoiceFieldProps {
  choices: Choice[]
  selected: string[]
  onChange: (ids: string[]) => void
  // The field's name, read aloud.
  label: string
  // What the empty field says, then once one is chosen (« Un autre thème ? »).
  placeholder: string
  morePlaceholder?: string
  // As many as can be chosen; past it, the field only shows the tags.
  max?: number
  disabled?: boolean
}

type ComboboxOptions = Pick<ChoiceFieldProps, 'choices' | 'selected' | 'onChange' | 'max'>

// The field's typing, the choices it offers and the one the arrow keys are on.
const useChoiceCombobox = ({ choices, selected, onChange, max = Infinity }: ComboboxOptions) => {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listId = useId()

  const full = selected.length >= max
  const offered = full
    ? []
    : choices.filter(choice => !selected.includes(choice.id) && foldText(choice.label).includes(foldText(query.trim())))
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
      const choice = offered[active] ?? offered[0]
      if (shown && choice) pick(choice.id)
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

interface ChoiceOptionsProps {
  offered: Choice[]
  active: number
  listId: string
  label: string
  attach: Ref<HTMLUListElement>
  style: CSSProperties
  pick: (id: string) => void
}

// The choices offered for what is typed, under the field, in the top layer: a dialog's edges never cut them.
const ChoiceOptions = ({ offered, active, listId, label, attach, style, pick }: ChoiceOptionsProps) => (
  <ul
    ref={attach}
    popover="manual"
    style={style}
    id={listId}
    role="listbox"
    className={styles.options}
    aria-label={label}
  >
    {offered.map((choice, index) => (
      <li
        key={choice.id}
        id={`${listId}-${choice.id}`}
        role="option"
        aria-selected={index === active}
        className={styles.option}
        data-topic={choice.topic}
        // Before the field's blur closes the list.
        onMouseDown={event => event.preventDefault()}
        onClick={() => pick(choice.id)}
      >
        {choice.icon && <span className={styles.optionIcon}>{choice.icon}</span>}
        {choice.label}
      </li>
    ))}
  </ul>
)

// Several choices as tags: the chosen ones (a tap takes one back), then a field that offers the others, all of them
// on focus and fewer as you type. Enter takes the first offered, Backspace in the empty field the last tag.
const ChoiceField = (props: ChoiceFieldProps) => {
  const { choices, selected, onChange, label, placeholder, morePlaceholder, disabled = false } = props
  const { t } = useTranslation()
  const combobox = useChoiceCombobox(props)
  const { listId, shown, offered, active, attach, floatingStyle, pick } = combobox
  const chosen = selected.flatMap(id => choices.filter(choice => choice.id === id))

  return (
    <div className={styles.wrap}>
      <div className={styles.field} aria-disabled={disabled || undefined}>
        {chosen.map(choice => (
          <button
            key={choice.id}
            type="button"
            className={styles.tag}
            data-topic={choice.topic}
            disabled={disabled}
            aria-label={t('choiceField.remove', { name: choice.label })}
            onClick={() => onChange(selected.filter(id => id !== choice.id))}
          >
            {choice.icon}
            {choice.label}
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
            placeholder={selected.length ? (morePlaceholder ?? placeholder) : placeholder}
            disabled={disabled}
            onChange={event => combobox.type(event.target.value)}
            // A tap or a click opens the list, not the focus a dialog gives its first field as it opens.
            onClick={() => combobox.setOpen(true)}
            // Long enough for a tap on an offered choice to land first.
            onBlur={() => window.setTimeout(() => combobox.setOpen(false), 150)}
            onKeyDown={combobox.handleKey}
            autoComplete="off"
            maxLength={40}
          />
        )}
      </div>
      {shown && (
        <ChoiceOptions
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

export default ChoiceField
