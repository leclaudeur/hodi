import { LogOut } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { type AccountView, deleteAccount, signOutDevice } from '../../../api.ts'
import { askToConfirm } from '../../../lib/confirm.ts'
import { deviceLabel } from '../../../lib/device-label.ts'
import { timeAgo } from '../../../lib/format.ts'
import { t } from '../../../lib/i18n.ts'
import { showError, showSaved } from '../../../lib/toast.ts'
import RichText from '../../../ui/RichText.tsx'
import { contentDays } from '../../../lib/content-days.ts'
import MoreRow from '../../../ui/MoreRow.tsx'
import SettingRow from '../SettingRow.tsx'
import styles from './AccountRows.module.css'

// A long list shows its first devices, the rest on demand in a box of its own height.
const FOLDED = 3

// This device as its browser describes itself, the installed app included.
export const labelOf = (agent: string, current: boolean) =>
  deviceLabel(agent, {
    standalone: current && window.matchMedia('(display-mode: standalone)').matches,
    browser: t('settings.account.browser')
  })

export const confirmDelete = (account: AccountView, t: TFunction) => {
  const deletion = account.deletion
  const children = deletion?.children ?? []
  const alone = children.length ? 'confirm.deleteAccount.messageChildren' : 'confirm.deleteAccount.message'
  const key = !deletion?.serverGoes
    ? alone
    : deletion.others.length
      ? 'confirm.deleteAccount.messageServerWith'
      : 'confirm.deleteAccount.messageServer'
  askToConfirm({
    title: t('confirm.deleteAccount.title'),
    message: (
      <RichText
        i18nKey={key}
        values={{
          email: account.email ?? '',
          // As many days as the server keeps copies (Serveur › Sauvegardes).
          days: t('count.day', { count: contentDays().backupCopies }),
          profiles: new Intl.ListFormat(undefined, { type: 'conjunction' }).format(deletion?.others ?? []),
          children: new Intl.ListFormat(undefined, { type: 'conjunction' }).format(children)
        }}
      />
    ),
    label: t('confirm.deleteAccount.button'),
    // Its password first, so that a device left open is not enough. An account without one of its own proves it by
    // a sign-in on this device in the last minutes instead, as for its e-mail.
    proof: account.loginOnly ? { noPassword: true } : {},
    onConfirm: async proof => {
      await deleteAccount(proof)
      // Signed out with it: the app starts again, on Connexion or on a new install's first-run screens.
      window.location.replace('/')
    }
  })
}

type Setter<T> = (value: T) => void

// Kept under its old name for Mon compte's page.
export { TwoFactorRows as TwoFactorRow } from './TwoFactorRows.tsx'

// The devices signed in with the account, this one first, each other one to sign out.
export const DeviceRows = ({
  account,
  onAccount,
  thisDevice
}: {
  account: AccountView
  onAccount: Setter<AccountView>
  thisDevice: ReactNode
}) => {
  const { t } = useTranslation()
  const [unfolded, setUnfolded] = useState(false)
  const signOut = (id: number, label: string) =>
    askToConfirm({
      title: t('confirm.signOutDevice.title', { device: label }),
      message: t('confirm.signOutDevice.message'),
      label: t('confirm.signOutDevice.button'),
      onConfirm: () =>
        void signOutDevice(id)
          .then(next => {
            onAccount(next)
            showSaved(t('settings.account.signedOut', { device: label }))
          })
          .catch(() => showError(t('settings.account.signOutFailed')))
    })

  const sorted = [...account.devices].sort((a, b) => Number(b.current) - Number(a.current))
  const shown = unfolded ? sorted : sorted.slice(0, FOLDED)
  const rows = shown.map(device => {
    const label = labelOf(device.userAgent, device.current)
    // « S'ouvre sans mot de passe »: the private profile trusts it (« Appareils de confiance » takes that back).
    const trusted = account.privateProfile && device.trusted ? ` · ${t('settings.account.trusted')}` : ''
    const currentHint = t(account.loginOnly ? 'settings.account.sessionHintNoPassword' : 'settings.account.sessionHint')
    return device.current ? (
      <SettingRow key={device.id} label={label} hint={trusted ? t('settings.account.trusted') : currentHint}>
        {thisDevice}
      </SettingRow>
    ) : (
      <SettingRow
        key={device.id}
        label={label}
        hint={`${t('settings.account.used', { when: timeAgo(new Date(device.lastSeenAt).toISOString()) })}${trusted}`}
        action={{
          label: t('settings.account.signOut'),
          ariaLabel: t('settings.account.signOutLabel', { device: label }),
          look: 'danger',
          icon: LogOut,
          onClick: () => signOut(device.id, label)
        }}
      />
    )
  })
  return (
    <>
      {unfolded ? <div className={styles.scrollList}>{rows}</div> : rows}
      {sorted.length > shown.length && (
        <MoreRow
          label={t('settings.account.moreDevices', { count: sorted.length - shown.length })}
          onClick={() => setUnfolded(true)}
        />
      )}
    </>
  )
}
