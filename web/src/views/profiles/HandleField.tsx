import { AtSign } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { HANDLE_MAX_LENGTH, cleanHandle, handleBase } from '../../../../shared/handle.ts'
import { checkHandle } from '../../api.ts'
import { LOCALES } from '../../lib/format.ts'
import { getLanguage } from '../../lib/i18n.ts'
import StatusLine from '../../ui/StatusLine.tsx'
import styles from './ProfileForm.module.css'

// Typing stops this long before the server is asked.
const CHECK_DELAY_MS = 300

type HandleStatus = 'rules' | 'checking' | 'free' | 'taken' | 'own'

interface Checked {
  handle: string
  free: boolean
  suggestion: string | null
}

// Whether the server has the identifier free, once typing stops. A failed check counts as free: the server checks again
// when the form is sent.
const useHandleCheck = (handle: string, enabled: boolean, code?: string) => {
  const [checked, setChecked] = useState<Checked | null>(null)
  const valid = enabled && cleanHandle(handle) === handle
  useEffect(() => {
    if (!valid) return
    let current = true
    const timer = setTimeout(() => {
      checkHandle(handle, code).then(
        ({ free, suggestion }) => current && setChecked({ handle, free, suggestion }),
        () => current && setChecked({ handle, free: true, suggestion: null })
      )
    }, CHECK_DELAY_MS)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [handle, valid, code])
  return checked?.handle === handle ? checked : null
}

interface HandleOptions {
  enabled: boolean
  // The account's own, which needs no check.
  current?: string
  // The one typed before, in the first-run screens.
  start?: string
  // Signed out, the invitation's code the account is made with.
  code?: string
}

// An account's identifier in its form: made from the name until it is typed, and then the free one like it when the
// name's is taken. ready: it can be sent.
export const useHandle = (name: string, { enabled, current, start, code }: HandleOptions) => {
  const [typed, setTyped] = useState<string | null>(current ?? start ?? null)
  const base = typed ?? (name.trim() ? handleBase(name) : '')
  const checked = useHandleCheck(base, enabled && base !== current, code)
  const suggested = typed === null && checked && !checked.free ? checked.suggestion : null
  const value = suggested ?? base
  const statusOf = (): HandleStatus => {
    if (value === current) return 'own'
    if (cleanHandle(value) !== value) return 'rules'
    if (suggested) return 'free'
    if (!checked) return 'checking'
    return checked.free ? 'free' : 'taken'
  }
  const status = statusOf()
  const ready = !enabled || status === 'free' || status === 'own'
  return { value, status, ready, suggestion: checked?.suggestion ?? null, onHandle: setTyped }
}

export type Handle = ReturnType<typeof useHandle>

const dayOf = (at: number) =>
  new Intl.DateTimeFormat(LOCALES[getLanguage()], { day: 'numeric', month: 'long' }).format(at)

// The line under the field: free in green, taken in red with a free one, else what an identifier may hold.
const HandleStatusLine = ({ handle, lockedUntil }: { handle: Handle; lockedUntil: number | null }) => {
  const { t } = useTranslation()
  const { value, status, suggestion } = handle
  if (lockedUntil !== null)
    return <StatusLine tone="info">{t('profileForm.handleLocked', { date: dayOf(lockedUntil) })}</StatusLine>
  if (status === 'own') return <StatusLine tone="info">{t('profileForm.handleEvery')}</StatusLine>
  if (status === 'free') return <StatusLine tone="success">{t('profileForm.handleFree', { handle: value })}</StatusLine>
  if (status === 'taken')
    return <StatusLine tone="error">{t('profileForm.handleTaken', { handle: value, other: suggestion })}</StatusLine>
  return <StatusLine tone="info">{t('profileForm.handleRules')}</StatusLine>
}

interface HandleFieldProps {
  handle: Handle
  // Changed less than 30 days ago: when it can change again.
  lockedUntil?: number | null
}

// « Identifiant »: unique on the server, for friends and mentions. Its "@" sits where the other fields have their icon.
const HandleField = ({ handle, lockedUntil = null }: HandleFieldProps) => {
  const { t } = useTranslation()
  const id = useId()
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {t('profileForm.handle')}
      </label>
      <span className={styles.handle} data-field>
        <AtSign size={16} aria-hidden="true" />
        <input
          id={id}
          type="text"
          value={handle.value}
          readOnly={lockedUntil !== null}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={HANDLE_MAX_LENGTH}
          aria-invalid={handle.status === 'taken'}
          onChange={event => handle.onHandle(event.target.value.trim().replace(/^@/, '').toLowerCase())}
        />
      </span>
      <HandleStatusLine handle={handle} lockedUntil={lockedUntil} />
    </div>
  )
}

export default HandleField
