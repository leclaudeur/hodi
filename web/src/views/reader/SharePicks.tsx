import { AtSign, Check } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type SharePerson, findShareTarget } from '../../api.ts'
import Button from '../../ui/Button.tsx'
import ProfileAvatar from '../../ui/ProfileAvatar.tsx'
import StatusLine from '../../ui/StatusLine.tsx'
import TextField from '../../ui/TextField.tsx'
import styles from './ShareToButton.module.css'

interface PersonPicksProps {
  people: SharePerson[]
  picked: number[]
  onToggle: (id: number) => void
}

// The people to send to, each ticked or not, with their @username under their name.
export const PersonPicks = ({ people, picked, onToggle }: PersonPicksProps) => (
  <ul className={styles.list}>
    {people.map(person => {
      const on = picked.includes(person.id)
      return (
        <li key={person.id}>
          <button
            type="button"
            role="checkbox"
            aria-checked={on}
            aria-label={person.name}
            className={styles.row}
            onClick={() => onToggle(person.id)}
          >
            <ProfileAvatar profile={person} size={44} />
            <span className={styles.who}>
              <span className={styles.name}>{person.name}</span>
              {person.handle && <span className={styles.handle}>@{person.handle}</span>}
            </span>
            <span className={`${styles.check} ${on ? styles.on : ''}`} aria-hidden="true">
              {on && <Check size={12} strokeWidth={3} />}
            </span>
          </button>
        </li>
      )
    })}
  </ul>
)

// Someone not offered yet, found by their @username: added to the list, ticked.
export const HandleAdder = ({ onFound }: { onFound: (person: SharePerson) => void }) => {
  const { t } = useTranslation()
  const [handle, setHandle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const typed = handle.trim().replace(/^@/, '')
  const find = async (event: FormEvent) => {
    event.preventDefault()
    if (!typed) return
    setBusy(true)
    setError(null)
    try {
      const person = await findShareTarget(typed)
      if (person) {
        onFound(person)
        setHandle('')
      } else setError(t('shareTo.unknown'))
    } catch {
      setError(t('shareTo.findFailed'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className={styles.handleRow} onSubmit={event => void find(event)}>
      <TextField
        icon={AtSign}
        aria-label={t('shareTo.handle')}
        placeholder={t('shareTo.handlePlaceholder')}
        value={handle}
        onChange={event => {
          setHandle(event.target.value)
          setError(null)
        }}
        autoCapitalize="none"
        autoComplete="off"
        spellCheck={false}
      />
      <Button type="submit" busy={busy} disabled={!typed}>
        {t('shareTo.add')}
      </Button>
      {error && <StatusLine tone="error">{error}</StatusLine>}
    </form>
  )
}
