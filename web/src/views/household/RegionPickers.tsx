import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { TIME_ZONES, countries, timeZoneCity, timeZoneOffset } from '../../lib/regions.ts'
import PickerDialog from './PickerDialog.tsx'
import RichText from '../../ui/RichText.tsx'

interface PickerProps<T> {
  open: boolean
  value: T
  onPick: (value: T) => void
  onClose: () => void
}

// Where the day of the fil and of the Résumé du jour changes.
export const TimeZonePicker = ({ open, value, onPick, onClose }: PickerProps<string>) => {
  const { t, i18n } = useTranslation()
  const options = useMemo(
    () =>
      open
        ? TIME_ZONES.map(timeZone => ({
            value: timeZone,
            label: `${timeZoneCity(timeZone)} · ${timeZone.split('/')[0]}`,
            meta: timeZoneOffset(timeZone)
          }))
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the offsets are written in the interface's language
    [open, i18n.language]
  )
  return (
    <PickerDialog
      open={open}
      title={t('regions.timeZone')}
      intro={<RichText i18nKey="dialogIntro.timeZone" />}
      searchLabel={t('regions.searchTimeZone')}
      placeholder={t('regions.timeZonePlaceholder')}
      options={options}
      value={value}
      onPick={onPick}
      onClose={onClose}
    />
  )
}

const NONE = ''

// The country the AI's web searches favour; none is fine.
export const CountryPicker = ({ open, value, onPick, onClose }: PickerProps<string | null>) => {
  const { t } = useTranslation()
  return (
    <PickerDialog
      open={open}
      title={t('regions.country')}
      intro={<RichText i18nKey="dialogIntro.country" />}
      searchLabel={t('regions.searchCountry')}
      placeholder={t('regions.countryPlaceholder')}
      options={[
        { value: NONE, label: t('regions.noCountry') },
        ...(open ? countries().map(({ code, name }) => ({ value: code, label: name })) : [])
      ]}
      value={value ?? NONE}
      onPick={picked => onPick(picked === NONE ? null : picked)}
      onClose={onClose}
    />
  )
}
