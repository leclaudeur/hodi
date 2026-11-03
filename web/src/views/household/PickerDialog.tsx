import { typesAtOnce } from '../../lib/use-media.ts'
import { Check, Search } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { foldText as fold } from '../../lib/word-match.ts'
import Dialog from '../../ui/Dialog.tsx'
import TextField from '../../ui/TextField.tsx'
import { useTranslation } from 'react-i18next'
import styles from './PickerDialog.module.css'

export interface PickerOption {
  value: string
  label: string
  // In mono at the end: "UTC+1".
  meta?: string
}

interface PickerDialogProps {
  open: boolean
  title: string
  intro?: ReactNode
  searchLabel: string
  placeholder: string
  options: PickerOption[]
  value: string | null
  onPick: (value: string) => void
  onClose: () => void
}

// A long list to pick one from (a time zone, a country), with a field to narrow it.
const PickerDialog = ({
  open,
  title,
  intro,
  searchLabel,
  placeholder,
  options,
  value,
  onPick,
  onClose
}: PickerDialogProps) => {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const shown = useMemo(() => {
    const words = fold(query).split(/\s+/).filter(Boolean)
    return words.length === 0
      ? options
      : options.filter(option => words.every(word => fold(`${option.label} ${option.value}`).includes(word)))
  }, [options, query])

  return (
    <Dialog open={open} onClose={onClose} title={title} intro={intro}>
      <TextField
        icon={Search}
        type="search"
        aria-label={searchLabel}
        placeholder={placeholder}
        value={query}
        onChange={event => setQuery(event.target.value)}
        onClear={() => setQuery('')}
        autoFocus={typesAtOnce()}
      />
      <ul className={styles.list} aria-label={title}>
        {shown.map(option => (
          <li key={option.value}>
            <button
              type="button"
              className={styles.option}
              aria-current={option.value === value ? 'true' : undefined}
              onClick={() => {
                onPick(option.value)
                onClose()
              }}
            >
              <span className={styles.label}>{option.label}</span>
              {option.meta && <span className={styles.meta}>{option.meta}</span>}
              {option.value === value && <Check size={16} aria-hidden="true" className={styles.check} />}
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className={styles.none}>{t('common.noResult')}</li>}
      </ul>
    </Dialog>
  )
}

export default PickerDialog
