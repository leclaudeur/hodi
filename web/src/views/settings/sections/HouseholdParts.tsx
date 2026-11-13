import { Camera, Trash2 } from 'lucide-react'
import { type RefObject, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type Household, UnauthorizedError, removeHouseholdPhoto, uploadHouseholdPhoto } from '../../../api.ts'
import { askToConfirm } from '../../../lib/confirm.ts'
import { MAX_PICKED_PHOTO_BYTES, PHOTO_ACCEPT, makePhoto } from '../../../lib/profiles.ts'
import { type HourCycle } from '../../../lib/format.ts'
import { switchGame } from '../../../lib/game.ts'
import { LANGUAGES, LANGUAGE_NAMES, type Language } from '../../../lib/i18n.ts'
import { showError, showSaved } from '../../../lib/toast.ts'
import HouseholdAvatar from '../../../ui/HouseholdAvatar.tsx'
import Segmented from '../../../ui/Segmented.tsx'
import Toggle from '../../../ui/Toggle.tsx'
import RichText from '../../../ui/RichText.tsx'
import SettingRow from '../SettingRow.tsx'
import styles from '../Settings.module.css'

export const useHouseholdPhoto = (name: string, saved: (next: Household) => void, onUnauthorized: () => void) => {
  const { t } = useTranslation()
  // The photo: picked, made square and small on the device, sent at once; « Retirer » asks first.
  const photoInput = useRef<HTMLInputElement>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const pickPhoto = async (file: File | undefined) => {
    if (!file) return
    if (file.size > MAX_PICKED_PHOTO_BYTES) {
      showError(t('profileForm.photoTooBig'))
      return
    }
    setPhotoBusy(true)
    try {
      saved(await uploadHouseholdPhoto(await makePhoto(file)))
    } catch (error) {
      if (error instanceof UnauthorizedError) onUnauthorized()
      else showError(t('settings.household.photoFailed'))
    } finally {
      setPhotoBusy(false)
    }
  }
  const removePhoto = () =>
    askToConfirm({
      title: t('settings.household.photoRemoveTitle'),
      message: <RichText i18nKey="settings.household.photoRemoveMessage" values={{ name }} />,
      label: t('profileForm.removePhoto'),
      onConfirm: () =>
        void removeHouseholdPhoto()
          .then(saved)
          .catch((error: unknown) => {
            if (error instanceof UnauthorizedError) onUnauthorized()
            else showError(t('settings.household.photoFailed'))
          })
    })
  return { photoInput, photoBusy, pickPhoto, removePhoto }
}

interface PhotoRowProps {
  household: Household
  photoInput: RefObject<HTMLInputElement | null>
  busy: boolean
  onPick: (file: File | undefined) => void
  onRemove: () => void
}

export const PhotoRow = ({ household, photoInput, busy, onPick, onRemove }: PhotoRowProps) => {
  const { t } = useTranslation()
  return (
    <>
      <SettingRow
        lead={<HouseholdAvatar name={household.name} photo={household.photo} size={44} />}
        label={t('settings.household.photo')}
        hint={<span className={styles.mono}>{t('settings.household.photoHint')}</span>}
        action={[
          ...(household.photo
            ? [
                {
                  label: t('settings.household.photoRemove'),
                  icon: Trash2,
                  look: 'danger' as const,
                  onClick: onRemove
                }
              ]
            : []),
          {
            label: t(household.photo ? 'settings.household.photoChange' : 'settings.household.photoAdd'),
            icon: Camera,
            busy,
            onClick: () => photoInput.current?.click()
          }
        ]}
      />
      <input
        ref={photoInput}
        type="file"
        accept={PHOTO_ACCEPT}
        hidden
        onChange={event => {
          onPick(event.target.files?.[0])
          event.target.value = ''
        }}
      />
    </>
  )
}

// The household game, on or off for everyone.
export const GameCard = ({
  enabled,
  switching,
  onSwitching
}: {
  enabled: boolean
  switching: boolean
  onSwitching: (switching: boolean) => void
}) => {
  const { t } = useTranslation()
  return (
    <>
      <h2 className={styles.label}>{t('settings.household.game')}</h2>
      <div className={styles.card}>
        <SettingRow label={t('settings.household.gameToggle')} hint={t('settings.household.gameHint')}>
          <Toggle
            checked={enabled}
            label={t('settings.household.gameToggle')}
            disabled={switching}
            onChange={next => {
              onSwitching(true)
              switchGame(next)
                .then(() => showSaved(t(next ? 'settings.household.gameOn' : 'settings.household.gameOff')))
                .catch(() => showError(t('settings.household.gameFailed')))
                .finally(() => onSwitching(false))
            }}
          />
        </SettingRow>
      </div>
    </>
  )
}

// The household's language and its time format.
export const RegionChoices = ({
  household,
  onLanguage,
  onHourCycle
}: {
  household: Household
  onLanguage: (language: Language) => void
  onHourCycle: (hourCycle: HourCycle) => void
}) => {
  const { t } = useTranslation()
  return (
    <>
      <SettingRow
        label={t('language.householdLabel')}
        hint={t('language.householdHint')}
        choice={
          <Segmented
            label={t('language.householdLabel')}
            value={household.language}
            onChange={onLanguage}
            options={LANGUAGES.map(option => ({
              value: option,
              title: LANGUAGE_NAMES[option],
              label: LANGUAGE_NAMES[option]
            }))}
          />
        }
      />
      <SettingRow
        label={t('hourCycle.label')}
        hint={t('hourCycle.hint')}
        choice={
          <Segmented
            label={t('hourCycle.label')}
            value={household.hourCycle}
            onChange={onHourCycle}
            options={([24, 12] as const).map(option => ({
              value: option,
              title: t(`hourCycle.example${option}`),
              label: t(`hourCycle.option${option}`)
            }))}
          />
        }
      />
    </>
  )
}
