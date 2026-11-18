import { KeyRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { type AccountView, forgetTrustedDevices, setPrivateProfile } from '../../../api.ts'
import { askToConfirm } from '../../../lib/confirm.ts'
import { showError, showSaved } from '../../../lib/toast.ts'
import RichText from '../../../ui/RichText.tsx'
import Toggle from '../../../ui/Toggle.tsx'
import SettingRow from '../SettingRow.tsx'

// « Profil privé »: « Qui lit ? » asks for this account's password before it opens its profile. Turning it on says so
// first, with the password: the one asked from then on, which a device left open does not prove.
const PrivateProfileRow = ({
  account,
  onAccount
}: {
  account: AccountView
  onAccount: (account: AccountView) => void
}) => {
  const { t } = useTranslation()
  const on = account.privateProfile ?? false
  const saved = (next: AccountView) => {
    onAccount(next)
    showSaved()
  }
  const failed = () => showError(t('settings.account.privateFailed'))
  const change = (next: boolean) => {
    if (!next) {
      setPrivateProfile(false).then(saved, failed)
      return
    }
    askToConfirm({
      title: t('confirm.privateOn.title'),
      message: <RichText i18nKey="confirm.privateOn.message" />,
      label: t('confirm.privateOn.button'),
      look: 'primary',
      proof: account.loginOnly ? { noPassword: true } : {},
      onConfirm: async proof => saved(await setPrivateProfile(true, proof))
    })
  }
  const trusted = account.devices.filter(device => device.trusted).length
  return (
    <>
      <SettingRow label={t('settings.account.private')} hint={t('settings.account.privateHint')}>
        <Toggle label={t('settings.account.private')} checked={on} onChange={change} />
      </SettingRow>
      {/* Every device that skips the password, taken back at once: the next opening asks again everywhere. */}
      {on && trusted > 0 && (
        <SettingRow
          label={t('settings.account.trustedDevices')}
          value={t('count.device', { count: trusted })}
          action={{
            label: t('settings.account.askAgain'),
            icon: KeyRound,
            onClick: () => void forgetTrustedDevices().then(saved, failed)
          }}
        />
      )}
    </>
  )
}

export default PrivateProfileRow
