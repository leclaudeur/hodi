import { Clock, Home, Pencil } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type Household, MAX_HOUSEHOLD_NAME_LENGTH, UnauthorizedError, updateHousehold } from '../../../api.ts'
import { type HourCycle, setHourCycle } from '../../../lib/format.ts'
import { useGameEnabled } from '../../../lib/game.ts'
import { type Language, setHouseholdLanguage } from '../../../lib/i18n.ts'
import { timeZoneCity, timeZoneOffset } from '../../../lib/regions.ts'
import { useHousehold } from '../../../lib/settings-data.ts'
import { showSaved } from '../../../lib/toast.ts'
import { typesAtOnce, useIsPhone } from '../../../lib/use-media.ts'
import Button from '../../../ui/Button.tsx'
import Dialog from '../../../ui/Dialog.tsx'
import DialogActions from '../../../ui/DialogActions.tsx'
import StatusLine from '../../../ui/StatusLine.tsx'
import TextField from '../../../ui/TextField.tsx'
import householdStyles from '../../household/Household.module.css'
import { TimeZonePicker } from '../../household/RegionPickers.tsx'
import RichText from '../../../ui/RichText.tsx'
import SectionPage from '../SectionPage.tsx'
import RowsSkeleton from '../SettingsSkeleton.tsx'
import SettingRow from '../SettingRow.tsx'
import styles from '../Settings.module.css'
import { GameCard, PhotoRow, RegionChoices, useHouseholdPhoto } from './HouseholdParts.tsx'
import ServerData from './ServerData.tsx'

type Editing = 'name' | 'timeZone' | null

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

// The language, the time format and the time zone, saved at once.
const useRegionSaving = (saved: (next: Household) => void, onUnauthorized: () => void) => {
  const [regionFailed, setRegionFailed] = useState(false)
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
  return { regionFailed, saveRegion, saveHourCycle, saveLanguage }
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
  const phone = useIsPhone()

  const saved = (next: Household) => {
    replace(next)
    showSaved()
  }

  const { regionFailed, saveRegion, saveHourCycle, saveLanguage } = useRegionSaving(saved, onUnauthorized)

  const { photoInput, photoBusy, pickPhoto, removePhoto } = useHouseholdPhoto(
    household?.name ?? '',
    saved,
    onUnauthorized
  )

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
            <PhotoRow
              household={household}
              photoInput={photoInput}
              busy={photoBusy}
              onPick={file => void pickPhoto(file)}
              onRemove={removePhoto}
            />
            <SettingRow
              label={t('settings.household.name')}
              value={household.name}
              action={{ label: t('settings.household.rename'), icon: Pencil, onClick: () => setEditing('name') }}
            />
            <RegionChoices household={household} onLanguage={saveLanguage} onHourCycle={saveHourCycle} />
          </div>

          <h2 className={styles.label}>{t('settings.household.region')}</h2>
          <div className={styles.card}>
            <SettingRow
              label={t('settings.household.timeZone')}
              value={t('settings.household.timeZoneValue', {
                zone: phone ? timeZoneCity(household.timeZone) : household.timeZone,
                offset: timeZoneOffset(household.timeZone)
              })}
              action={{ label: t('common.change'), icon: Clock, onClick: () => setEditing('timeZone') }}
            />
          </div>
          {regionFailed && <StatusLine tone="error">{t('settings.household.regionFailed')}</StatusLine>}

          {gameEnabled !== null && <GameCard enabled={gameEnabled} switching={switching} onSwitching={setSwitching} />}

          <ServerData />

          {dialogProps && editing === 'name' && <RenameDialog {...dialogProps} />}
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
