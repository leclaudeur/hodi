import { LogOut } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type ProfileDevice, getProfileDevices, removeProfileDevice } from '../../api.ts'
import { askToConfirm } from '../../lib/confirm.ts'
import { deviceLabel } from '../../lib/device-label.ts'
import { timeAgo } from '../../lib/format.ts'
import { showError, showSaved } from '../../lib/toast.ts'
import RichText from '../../ui/RichText.tsx'
import SettingRow from '../settings/SettingRow.tsx'

interface YoungDevicesProps {
  profile: { id: number; name: string }
}

// A young profile's own devices, on its page (Réglages > Profils > Gérer > Appareils): each one linked by a parent's
// code, and "Retirer" to unlink it (it then asks for a new code). Nothing while there is none: the "Connecter un
// appareil" row under them says it all.
const YoungDevices = ({ profile }: YoungDevicesProps) => {
  const { t } = useTranslation()
  const [devices, setDevices] = useState<ProfileDevice[]>([])

  useEffect(() => {
    let cancelled = false
    getProfileDevices(profile.id)
      .then(found => {
        if (!cancelled) setDevices(found)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [profile.id])

  const remove = (device: ProfileDevice, label: string) =>
    askToConfirm({
      title: t('confirm.removeYoungDevice.title', { device: label }),
      message: <RichText i18nKey="confirm.removeYoungDevice.message" values={{ name: profile.name }} />,
      label: t('confirm.removeYoungDevice.button'),
      onConfirm: () =>
        void removeProfileDevice(profile.id, device.id)
          .then(() => {
            setDevices(current => current.filter(other => other.id !== device.id))
            showSaved(t('young.deviceRemoved', { device: label }))
          })
          .catch(() => showError(t('young.deviceRemoveFailed')))
    })

  return devices.map(device => {
    const label = deviceLabel(device.userAgent, { browser: t('settings.account.browser') })
    return (
      <SettingRow
        key={device.id}
        label={label}
        hint={t('settings.account.used', { when: timeAgo(new Date(device.lastSeenAt).toISOString()) })}
        action={{
          label: t('young.removeDevice'),
          ariaLabel: t('young.removeDeviceLabel', { device: label }),
          look: 'danger',
          icon: LogOut,
          onClick: () => remove(device, label)
        }}
      />
    )
  })
}

export default YoungDevices
