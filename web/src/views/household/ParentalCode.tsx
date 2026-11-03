import { typesAtOnce } from '../../lib/use-media.ts'
import { KeyRound } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PIN_LENGTH, PIN_PATTERN, RequestError } from '../../api.ts'
import { changeParentalPin, isYoung, useProfiles } from '../../lib/profiles.ts'
import { showSaved } from '../../lib/toast.ts'
import Button from '../../ui/Button.tsx'
import Dialog from '../../ui/Dialog.tsx'
import DialogActions from '../../ui/DialogActions.tsx'
import PinField from '../../ui/PinField.tsx'
import StatusLine from '../../ui/StatusLine.tsx'
import Toggle from '../../ui/Toggle.tsx'
import SettingRow from '../settings/SettingRow.tsx'
import settingsStyles from '../settings/Settings.module.css'
import pinStyles from '../profiles/PinSettings.module.css'
import RichText from '../../ui/RichText.tsx'

type Mode = 'set' | 'change' | 'remove'

// Réglages > Foyer > Famille, once the household has young profiles: the Code parental, which opens every adult
// that is not private. A switch and a row as a private profile's PIN, set, changed and removed in the same dialog:
// a family may not want one.
const ParentalCode = () => {
  const { t } = useTranslation()
  const value = useProfiles()
  const [mode, setMode] = useState<Mode | null>(null)
  const [current, setCurrent] = useState('')
  const [pin, setPin] = useState('')
  const [again, setAgain] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!value?.profiles.some(isYoung)) return null
  const set = value.parentalCode

  const start = (next: Mode | null) => {
    setMode(next)
    setCurrent('')
    setPin('')
    setAgain('')
    setError(null)
  }

  const needsCurrent = mode === 'change' || mode === 'remove'
  const needsNew = mode === 'set' || mode === 'change'
  const mismatch = needsNew && again.length === PIN_LENGTH && pin !== again
  const ready = (!needsCurrent || PIN_PATTERN.test(current)) && (!needsNew || (PIN_PATTERN.test(pin) && pin === again))

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!ready) return
    setSaving(true)
    setError(null)
    try {
      await changeParentalPin(needsNew ? pin : null, needsCurrent ? current : undefined)
      showSaved(t(mode === 'remove' ? 'family.removed' : 'family.saved'))
      start(null)
    } catch (failure) {
      setError(
        failure instanceof RequestError && failure.code === 'wrong_pin'
          ? t('family.wrong')
          : failure instanceof RequestError && failure.code === 'too_many_attempts'
            ? t('common.tooManyAttempts', {
                minutes: Math.max(1, Math.ceil((failure.retryAfterSeconds ?? 60) / 60))
              })
            : t('family.failed')
      )
    } finally {
      setSaving(false)
    }
  }

  const intro = (
    <RichText
      i18nKey={
        mode === 'set'
          ? 'dialogIntro.parentalSet'
          : mode === 'remove'
            ? 'dialogIntro.parentalRemove'
            : 'dialogIntro.codeChange'
      }
    />
  )
  const title = t(mode === 'set' ? 'family.setTitle' : mode === 'remove' ? 'family.removeTitle' : 'family.changeTitle')

  return (
    <>
      <h2 className={settingsStyles.label}>{t('family.title')}</h2>
      <div className={settingsStyles.card}>
        <SettingRow label={t('family.parentalCode')} hint={set ? t('family.parentalHint') : t('family.parentalNone')}>
          {/* The switch only opens the dialog: it moves once the code is saved or removed. */}
          <Toggle label={t('family.parentalCode')} checked={set} onChange={on => start(on ? 'set' : 'remove')} />
        </SettingRow>
        {set && (
          <SettingRow label={t('family.code')} hint={t('pin.digits')}>
            <Button icon={KeyRound} onClick={() => start('change')}>
              {t('family.change')}
            </Button>
          </SettingRow>
        )}
      </div>

      <Dialog open={mode !== null} onClose={() => start(null)} title={title} intro={intro}>
        <form className={pinStyles.form} onSubmit={submit}>
          {needsCurrent && (
            <PinField label={t('family.current')} value={current} onChange={setCurrent} autoFocus={typesAtOnce()} />
          )}
          {needsNew && (
            <>
              <PinField
                label={t('family.new')}
                value={pin}
                onChange={setPin}
                autoFocus={!needsCurrent && typesAtOnce()}
              />
              <PinField
                label={t('family.again')}
                value={again}
                state={mismatch ? 'wrong' : 'idle'}
                onChange={setAgain}
              />
            </>
          )}
          {mismatch ? (
            <StatusLine tone="error" className={pinStyles.status}>
              {t('family.mismatch')}
            </StatusLine>
          ) : (
            error && (
              <StatusLine tone="error" className={pinStyles.status}>
                {error}
              </StatusLine>
            )
          )}
          <DialogActions>
            <Button onClick={() => start(null)}>{t('common.cancel')}</Button>
            <Button type="submit" look={mode === 'remove' ? 'danger' : 'primary'} busy={saving} disabled={!ready}>
              {t(mode === 'remove' ? 'family.remove' : 'common.save')}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </>
  )
}

export default ParentalCode
