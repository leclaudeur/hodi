import { KeyRound, LogOut, ShieldCheck, ShieldOff } from 'lucide-react'
import { type ReactNode } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import {
  type AccountView,
  deleteAccount,
  newRecoveryCodes,
  signOutDevice,
  startTwoFactor,
  stopTwoFactor
} from '../../../api.ts'
import { askToConfirm } from '../../../lib/confirm.ts'
import { deviceLabel } from '../../../lib/device-label.ts'
import { numericDate, timeAgo } from '../../../lib/format.ts'
import { t } from '../../../lib/i18n.ts'
import { showError, showSaved } from '../../../lib/toast.ts'
import RichText from '../../../ui/RichText.tsx'
import { contentDays } from '../../../lib/content-days.ts'
import type { TwoFactorSecret } from '../../account/TwoFactorSetup.tsx'
import { setTwoFactorOn } from '../../../lib/two-factor.ts'
import SettingRow from '../SettingRow.tsx'

// This device as its browser describes itself, the installed app included.
export const labelOf = (agent: string, current: boolean) =>
  deviceLabel(agent, {
    standalone: current && window.matchMedia('(display-mode: standalone)').matches,
    browser: t('settings.account.browser')
  })

export const confirmDelete = (account: AccountView, t: TFunction) => {
  const deletion = account.deletion
  const key = !deletion?.householdGoes
    ? 'confirm.deleteAccount.message'
    : deletion.others.length
      ? 'confirm.deleteAccount.messageHouseholdWith'
      : 'confirm.deleteAccount.messageHousehold'
  askToConfirm({
    title: t('confirm.deleteAccount.title'),
    message: (
      <RichText
        i18nKey={key}
        values={{
          email: account.email,
          // As many days as the server keeps copies (Serveur › Sauvegardes).
          days: t('count.day', { count: contentDays().backupCopies }),
          name: deletion?.household ?? '',
          profiles: new Intl.ListFormat(undefined, { type: 'conjunction' }).format(deletion?.others ?? [])
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

// « Validation en deux étapes »: required for the server's account, which cannot turn it off.
export const TwoFactorRow = ({
  account,
  onAccount,
  onStarted,
  onNewCodes
}: {
  account: AccountView
  onAccount: Setter<AccountView>
  onStarted: Setter<TwoFactorSecret>
  onNewCodes: Setter<string[]>
}) => {
  const { t } = useTranslation()
  // « Activer »: its password first (a device left open is not enough to tie the account to another phone), then
  // the app's QR.
  const turnOn = () =>
    askToConfirm({
      title: t('twoFactor.account.confirmOn.title'),
      message: t('twoFactor.account.confirmOn.message'),
      label: t('twoFactor.account.confirmOn.button'),
      look: 'primary',
      proof: account.loginOnly ? { noPassword: true } : {},
      onConfirm: async ({ password }) => {
        onStarted(await startTwoFactor(account.loginOnly ? undefined : password))
      }
    })

  return (
    <SettingRow
      label={t('twoFactor.account.row')}
      value={
        account.twoFactor.since === null
          ? t('twoFactor.account.off')
          : t('twoFactor.account.on', { date: numericDate(new Date(account.twoFactor.since).toISOString()) })
      }
      action={
        account.twoFactor.since === null
          ? { label: t('twoFactor.account.turnOn'), icon: ShieldCheck, onClick: turnOn }
          : [
              {
                label: t('twoFactor.account.newCodes'),
                icon: KeyRound,
                onClick: () =>
                  askToConfirm({
                    title: t('twoFactor.account.confirmCodes.title'),
                    message: t('twoFactor.account.confirmCodes.message'),
                    label: t('twoFactor.account.confirmCodes.button'),
                    look: 'primary',
                    proof: account.loginOnly ? { noPassword: true } : {},
                    onConfirm: async proof => {
                      onNewCodes((await newRecoveryCodes(proof)).recoveryCodes)
                    }
                  })
              },
              ...(account.twoFactor.required
                ? []
                : [
                    {
                      label: t('twoFactor.account.turnOff'),
                      icon: ShieldOff,
                      look: 'danger' as const,
                      onClick: () =>
                        askToConfirm({
                          title: t('twoFactor.account.confirmOff.title'),
                          message: t('twoFactor.account.confirmOff.message'),
                          label: t('twoFactor.account.confirmOff.button'),
                          proof: account.loginOnly ? { noPassword: true } : {},
                          onConfirm: async proof => {
                            await stopTwoFactor(proof)
                            setTwoFactorOn(false)
                            onAccount({ ...account, twoFactor: { ...account.twoFactor, since: null } })
                          }
                        })
                    }
                  ])
            ]
      }
    />
  )
}

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

  return (
    <>
      {[...account.devices]
        .sort((a, b) => Number(b.current) - Number(a.current))
        .map(device => {
          const label = labelOf(device.userAgent, device.current)
          return device.current ? (
            <SettingRow
              key={device.id}
              label={label}
              hint={t(account.loginOnly ? 'settings.account.sessionHintNoPassword' : 'settings.account.sessionHint')}
            >
              {thisDevice}
            </SettingRow>
          ) : (
            <SettingRow
              key={device.id}
              label={label}
              hint={t('settings.account.used', {
                when: timeAgo(new Date(device.lastSeenAt).toISOString())
              })}
              action={{
                label: t('settings.account.signOut'),
                ariaLabel: t('settings.account.signOutLabel', { device: label }),
                look: 'danger',
                icon: LogOut,
                onClick: () => signOut(device.id, label)
              }}
            />
          )
        })}
    </>
  )
}
