import { Clock, Home, KeyRound, LogOut, Pencil } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  type Household,
  MAX_HOUSEHOLD_NAME_LENGTH,
  RequestError,
  UnauthorizedError,
  changeHouseholdPassword,
  signOutOtherDevices,
  updateHousehold
} from '../../../api.ts'
import { askToConfirm } from '../../../lib/confirm.ts'
import { type HourCycle, numericDate, setHourCycle } from '../../../lib/format.ts'
import { switchGame, useGameEnabled } from '../../../lib/game.ts'
import { LANGUAGES, LANGUAGE_NAMES, type Language, setHouseholdLanguage } from '../../../lib/i18n.ts'
import { passwordStrength } from '../../../lib/password-strength.ts'
import { timeZoneCity, timeZoneOffset } from '../../../lib/regions.ts'
import { useHousehold } from '../../../lib/settings-data.ts'
import { showDone, showError, showSaved } from '../../../lib/toast.ts'
import { typesAtOnce, useIsPhone } from '../../../lib/use-media.ts'
import Button from '../../../ui/Button.tsx'
import Dialog from '../../../ui/Dialog.tsx'
import DialogActions from '../../../ui/DialogActions.tsx'
import PasswordField from '../../../ui/PasswordField.tsx'
import PasswordGauge from '../../../ui/PasswordGauge.tsx'
import Segmented from '../../../ui/Segmented.tsx'
import StatusLine from '../../../ui/StatusLine.tsx'
import TextField from '../../../ui/TextField.tsx'
import Toggle from '../../../ui/Toggle.tsx'
import householdStyles from '../../household/Household.module.css'
import ParentalCode from '../../household/ParentalCode.tsx'
import { TimeZonePicker } from '../../household/RegionPickers.tsx'
import RichText from '../../../ui/RichText.tsx'
import SectionPage from '../SectionPage.tsx'
import RowsSkeleton from '../SettingsSkeleton.tsx'
import SettingRow from '../SettingRow.tsx'
import styles from '../Settings.module.css'
import ServerData from './ServerData.tsx'

type Editing = 'name' | 'password' | 'timeZone' | null

interface DialogProps {
  household: Household
  onSaved: (next: Household) => void
  onClose: () => void
  onUnauthorized: () => void
}

const RenameDialog = ({ household, onSaved, onClose, onUnauthorized }: DialogProps) => {
  const { t } = useTranslation()
  const [name, setName] = useState(household.name)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setFailed(false)
    try {
      onSaved(await updateHousehold({ name: name.replace(/\s+/g, ' ').trim() }))
      onClose()
    } catch (error) {
      if (error instanceof UnauthorizedError) onUnauthorized()
      else setFailed(true)
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('settings.household.renameTitle')}
      intro={<RichText i18nKey="dialogIntro.rename" />}
    >
      <form className={householdStyles.form} onSubmit={submit}>
        <TextField
          icon={Home}
          aria-label={t('setup.household.name')}
          maxLength={MAX_HOUSEHOLD_NAME_LENGTH}
          autoFocus={typesAtOnce()}
          required
          value={name}
          onChange={event => setName(event.target.value)}
        />
        {failed && <StatusLine tone="error">{t('settings.household.renameFailed')}</StatusLine>}
        <DialogActions>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" look="primary" busy={saving} disabled={!name.trim()}>
            {t('common.save')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

// The other devices sign in again with the new one; this one stays signed in.
const PasswordDialog = ({ onSaved, onClose, onUnauthorized }: DialogProps) => {
  const { t } = useTranslation()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  // Typed twice, as in the setup wizard: a typo here would lock every device out.
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mismatch = confirm !== '' && confirm !== next
  const wrong = t('settings.household.wrongPassword')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      onSaved(await changeHouseholdPassword(current, next))
      onClose()
    } catch (failure) {
      if (failure instanceof UnauthorizedError) onUnauthorized()
      else if (failure instanceof RequestError && failure.code === 'invalid_password') setError(wrong)
      else if (failure instanceof RequestError && failure.code === 'too_many_attempts')
        setError(t('common.tooManyAttempts', { minutes: Math.ceil((failure.retryAfterSeconds ?? 900) / 60) }))
      else setError(t('settings.household.passwordFailed'))
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('settings.household.passwordTitle')}
      intro={<RichText i18nKey="dialogIntro.password" />}
    >
      <form className={householdStyles.form} onSubmit={submit}>
        <div className={householdStyles.field}>
          <span className={householdStyles.fieldLabel}>{t('settings.household.currentPassword')}</span>
          <PasswordField
            aria-label={t('settings.household.currentPassword')}
            autoComplete="current-password"
            autoFocus={typesAtOnce()}
            required
            invalid={error === wrong}
            value={current}
            onChange={event => setCurrent(event.target.value)}
          />
        </div>
        <div className={householdStyles.field}>
          <span className={householdStyles.fieldLabel}>{t('settings.household.newPassword')}</span>
          <PasswordField
            icon={KeyRound}
            aria-label={t('settings.household.newPassword')}
            autoComplete="new-password"
            required
            value={next}
            onChange={event => setNext(event.target.value)}
          />
          <PasswordGauge password={next} />
        </div>
        <div className={householdStyles.field}>
          <span className={householdStyles.fieldLabel}>{t('passwordChange.confirm')}</span>
          <PasswordField
            icon={KeyRound}
            aria-label={t('passwordChange.confirm')}
            autoComplete="new-password"
            required
            invalid={mismatch}
            value={confirm}
            onChange={event => setConfirm(event.target.value)}
          />
          {mismatch && <StatusLine tone="error">{t('setup.household.mismatch')}</StatusLine>}
        </div>
        {error && <StatusLine tone="error">{error}</StatusLine>}
        <DialogActions>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            type="submit"
            look="primary"
            busy={saving}
            disabled={!current || passwordStrength(next).score === 0 || confirm !== next}
          >
            {t('common.save')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

interface HouseholdSectionProps {
  layout: 'desktop' | 'phone'
  onUnauthorized: () => void
}

// Réglages > Foyer, the admin's: what holds for the whole install.
const HouseholdSection = ({ layout, onUnauthorized }: HouseholdSectionProps) => {
  const { t } = useTranslation()
  const { value: household, failed, replace } = useHousehold(onUnauthorized)
  const [editing, setEditing] = useState<Editing>(null)
  const gameEnabled = useGameEnabled()
  const [switching, setSwitching] = useState(false)
  const [regionFailed, setRegionFailed] = useState(false)
  const phone = useIsPhone()

  const saved = (next: Household) => {
    replace(next)
    showSaved()
  }

  const saveRegion = (changes: { timeZone?: string }) => {
    setRegionFailed(false)
    updateHousehold(changes)
      .then(saved)
      .catch((error: unknown) => {
        if (error instanceof UnauthorizedError) onUnauthorized()
        else setRegionFailed(true)
      })
  }

  // For every profile and device: the rows, the fields and the push texts that write a time of day.
  const saveHourCycle = (hourCycle: HourCycle) => {
    setRegionFailed(false)
    setHourCycle(hourCycle)
    updateHousehold({ hourCycle })
      .then(saved)
      .catch((error: unknown) => {
        if (error instanceof UnauthorizedError) onUnauthorized()
        else setRegionFailed(true)
      })
  }

  const saveLanguage = (language: Language) => {
    setRegionFailed(false)
    updateHousehold({ language })
      .then(next => {
        saved(next)
        setHouseholdLanguage(next.language)
      })
      .catch((error: unknown) => {
        if (error instanceof UnauthorizedError) onUnauthorized()
        else setRegionFailed(true)
      })
  }

  const signOutOthers = async () => {
    try {
      await signOutOtherDevices()
      showDone(t('settings.household.signedOut'))
    } catch {
      showError(t('settings.household.signOutFailed'))
    }
  }

  const close = () => setEditing(null)
  const dialogProps = household ? { household, onSaved: saved, onClose: close, onUnauthorized } : null

  return (
    <SectionPage title={t('settings.nav.household')} intro={t('settings.household.intro')} layout={layout}>
      {failed ? (
        <StatusLine tone="error">{t('settings.household.loadFailed')}</StatusLine>
      ) : !household ? (
        <RowsSkeleton rows={4} />
      ) : (
        <>
          <h2 className={styles.label}>{t('settings.household.heading')}</h2>
          <div className={styles.card}>
            <SettingRow
              label={t('settings.household.name')}
              hint={t('settings.household.nameHint', { name: household.name })}
            >
              <Button icon={Pencil} onClick={() => setEditing('name')}>
                {t('settings.household.rename')}
              </Button>
            </SettingRow>
            <SettingRow label={t('language.householdLabel')} hint={t('language.householdHint')}>
              <Segmented
                label={t('language.householdLabel')}
                value={household.language}
                onChange={saveLanguage}
                options={LANGUAGES.map(option => ({
                  value: option,
                  title: LANGUAGE_NAMES[option],
                  label: layout === 'desktop' ? LANGUAGE_NAMES[option] : option.toUpperCase()
                }))}
              />
            </SettingRow>
            <SettingRow label={t('hourCycle.label')} hint={t('hourCycle.hint')}>
              <Segmented
                label={t('hourCycle.label')}
                value={household.hourCycle}
                onChange={saveHourCycle}
                options={([24, 12] as const).map(option => ({
                  value: option,
                  title: t(`hourCycle.example${option}`),
                  label: t(`hourCycle.option${option}`)
                }))}
              />
            </SettingRow>
            <SettingRow
              label={t('setup.household.password')}
              hint={
                household.passwordChangedAt
                  ? t('settings.household.passwordChanged', {
                      date: numericDate(new Date(household.passwordChangedAt).toISOString())
                    })
                  : t('settings.household.passwordHint')
              }
            >
              <Button icon={KeyRound} onClick={() => setEditing('password')}>
                {t('pin.change')}
              </Button>
            </SettingRow>
            <SettingRow label={t('settings.household.otherDevices')} hint={t('settings.household.otherDevicesHint')}>
              <Button
                look="danger"
                icon={LogOut}
                onClick={() =>
                  askToConfirm({
                    title: t('confirm.logoutOthers.title'),
                    message: <RichText i18nKey="confirm.logoutOthers.message" />,
                    label: t('confirm.logoutOthers.button'),
                    onConfirm: () => void signOutOthers()
                  })
                }
              >
                {t('settings.household.signOut')}
              </Button>
            </SettingRow>
          </div>

          <h2 className={styles.label}>{t('settings.household.region')}</h2>
          <div className={styles.card}>
            <SettingRow
              label={t('settings.household.timeZone')}
              hint={t('settings.household.timeZoneHint', { offset: timeZoneOffset(household.timeZone) })}
            >
              <Button icon={Clock} onClick={() => setEditing('timeZone')}>
                {phone ? timeZoneCity(household.timeZone) : household.timeZone}
              </Button>
            </SettingRow>
          </div>
          {regionFailed && <StatusLine tone="error">{t('settings.household.regionFailed')}</StatusLine>}

          <ParentalCode />

          {gameEnabled !== null && (
            <>
              <h2 className={styles.label}>{t('settings.household.game')}</h2>
              <div className={styles.card}>
                <SettingRow label={t('settings.household.gameToggle')} hint={t('settings.household.gameHint')}>
                  <Toggle
                    checked={gameEnabled}
                    label={t('settings.household.gameToggle')}
                    disabled={switching}
                    onChange={enabled => {
                      setSwitching(true)
                      switchGame(enabled)
                        .then(() => showSaved(t(enabled ? 'settings.household.gameOn' : 'settings.household.gameOff')))
                        .catch(() => showError(t('settings.household.gameFailed')))
                        .finally(() => setSwitching(false))
                    }}
                  />
                </SettingRow>
              </div>
            </>
          )}

          <ServerData />

          {dialogProps && editing === 'name' && <RenameDialog {...dialogProps} />}
          {dialogProps && editing === 'password' && <PasswordDialog {...dialogProps} />}
          <TimeZonePicker
            open={editing === 'timeZone'}
            value={household.timeZone}
            onPick={timeZone => saveRegion({ timeZone })}
            onClose={close}
          />
        </>
      )}
    </SectionPage>
  )
}

export default HouseholdSection
