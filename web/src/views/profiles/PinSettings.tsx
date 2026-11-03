import { typesAtOnce } from '../../lib/use-media.ts'
import { KeyRound } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PIN_LENGTH, PIN_PATTERN, type Profile, RequestError } from '../../api.ts'
import { t } from '../../lib/i18n.ts'
import { changePin } from '../../lib/profiles.ts'
import { showSaved } from '../../lib/toast.ts'
import Button from '../../ui/Button.tsx'
import Dialog from '../../ui/Dialog.tsx'
import DialogActions from '../../ui/DialogActions.tsx'
import PinField from '../../ui/PinField.tsx'
import StatusLine from '../../ui/StatusLine.tsx'
import Toggle from '../../ui/Toggle.tsx'
import SettingRow from '../settings/SettingRow.tsx'
import styles from '../settings/Settings.module.css'
import pinStyles from './PinSettings.module.css'
import RichText from '../../ui/RichText.tsx'

type Mode = 'set' | 'change' | 'remove'

const errorOf = (failure: unknown) =>
  failure instanceof RequestError && failure.code === 'wrong_pin'
    ? t('pin.wrongCurrent')
    : failure instanceof RequestError && failure.code === 'too_many_attempts'
      ? t('pin.tooMany')
      : t('pin.saveFailed')

// "Sécurité": a private profile asks its PIN in "Qui lit ?" before it opens. Turned private with a new PIN,
// public again with the current one; the PIN changed here too. Each of the three happens in a dialog.
const PinSettings = ({ profile }: { profile: Profile }) => {
  const { t } = useTranslation()
  const [mode, setMode] = useState<Mode | null>(null)
  const [current, setCurrent] = useState('')
  const [pin, setPin] = useState('')
  const [again, setAgain] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      await changePin(profile.id, needsNew ? pin : null, needsCurrent ? current : undefined)
      start(null)
      showSaved(t(mode === 'set' ? 'pin.nowPrivate' : mode === 'remove' ? 'pin.nowPublic' : 'pin.changed'))
    } catch (failure) {
      setError(errorOf(failure))
    } finally {
      setSaving(false)
    }
  }

  const intro = (
    <RichText
      i18nKey={
        mode === 'set' ? 'dialogIntro.pinSet' : mode === 'remove' ? 'dialogIntro.pinRemove' : 'dialogIntro.codeChange'
      }
    />
  )
  const title = t(mode === 'set' ? 'pin.setTitle' : mode === 'remove' ? 'pin.removeTitle' : 'pin.changeTitle')

  return (
    <>
      <h2 className={styles.label}>{t('profileForm.security')}</h2>
      <div className={styles.card}>
        <SettingRow label={t('profileForm.private')} hint={t(profile.locked ? 'pin.lockedHint' : 'pin.openHint')}>
          {/* The switch only opens the dialog: it moves once the code is saved. */}
          <Toggle
            label={t('profileForm.private')}
            checked={profile.locked}
            onChange={on => start(on ? 'set' : 'remove')}
          />
        </SettingRow>
        {profile.locked && (
          <SettingRow label={t('profiles.pin')} hint={t('pin.digits')}>
            <Button icon={KeyRound} onClick={() => start('change')}>
              {t('pin.change')}
            </Button>
          </SettingRow>
        )}
      </div>

      <Dialog open={mode !== null} onClose={() => start(null)} title={title} intro={intro}>
        <form className={pinStyles.form} onSubmit={submit}>
          {needsCurrent && (
            <PinField
              label={t(mode === 'remove' ? 'pin.yourCurrent' : 'pin.current')}
              value={current}
              onChange={setCurrent}
              autoFocus={typesAtOnce()}
            />
          )}
          {needsNew && (
            <>
              <PinField
                label={t(mode === 'set' ? 'pin.yours' : 'pin.new')}
                value={pin}
                onChange={setPin}
                autoFocus={!needsCurrent && typesAtOnce()}
              />
              <PinField label={t('pin.again')} value={again} state={mismatch ? 'wrong' : 'idle'} onChange={setAgain} />
            </>
          )}
          {mismatch && (
            <StatusLine tone="error" className={pinStyles.status}>
              {t('pin.mismatch')}
            </StatusLine>
          )}
          {error && (
            <StatusLine tone="error" className={pinStyles.status}>
              {error}
            </StatusLine>
          )}
          <DialogActions>
            <Button onClick={() => start(null)}>{t('common.cancel')}</Button>
            <Button type="submit" look="primary" busy={saving} disabled={!ready}>
              {t(
                saving
                  ? 'common.saving'
                  : mode === 'set'
                    ? 'pin.makePrivate'
                    : mode === 'remove'
                      ? 'pin.makePublic'
                      : 'common.save'
              )}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </>
  )
}

export default PinSettings
