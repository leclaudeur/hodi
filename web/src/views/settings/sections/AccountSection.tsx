import { Download, KeyRound, Pencil, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ACCOUNT_COPY_URL, type AccountView, UnauthorizedError, getAccount } from '../../../api.ts'
import { numericDate } from '../../../lib/format.ts'
import { setOfflineReading, useKeptOffline, useOfflineReading } from '../../../lib/offline.ts'
import { showSaved } from '../../../lib/toast.ts'
import Chip from '../../../ui/Chip.tsx'
import Toggle from '../../../ui/Toggle.tsx'
import TwoFactorDialog, { RecoveryCodesDialog } from '../../account/TwoFactorDialog.tsx'
import type { TwoFactorSecret } from '../../account/TwoFactorSetup.tsx'
import { setTwoFactorOn } from '../../../lib/two-factor.ts'
import { EmailDialog, PasswordDialog } from './AccountDialogs.tsx'
import SettingRow from '../SettingRow.tsx'
import styles from '../Settings.module.css'
import { PluginSlots } from '../../../plugins/Slots.tsx'
import AccountProfile from './AccountProfile.tsx'
import HouseholdCard from './HouseholdCard.tsx'
import AccountStatsCard from './AccountStatsCard.tsx'
import { DeviceRows, TwoFactorRow, confirmDelete, labelOf } from './AccountRows.tsx'
import PrivateProfileRow from './PrivateProfileRow.tsx'

// undefined while it comes; null: no account here.
export const useAccount = (onUnauthorized: () => void) => {
  const [account, setAccount] = useState<AccountView | null | undefined>(undefined)
  useEffect(() => {
    getAccount()
      .then(setAccount)
      .catch((failure: unknown) => {
        if (failure instanceof UnauthorizedError) onUnauthorized()
        else setAccount(null)
      })
  }, [onUnauthorized])
  return [account, setAccount] as const
}

// This device's offline reading, with how many articles it keeps.
const OfflineRow = () => {
  const { t } = useTranslation()
  const offline = useOfflineReading()
  const kept = useKeptOffline().size
  return (
    <SettingRow
      label={t('settings.account.offlineReading')}
      value={kept > 0 ? t('settings.account.ready', { count: kept }) : undefined}
      hint={t('settings.account.offlineHint')}
    >
      <Toggle label={t('settings.account.offlineReading')} checked={offline} onChange={setOfflineReading} />
    </SettingRow>
  )
}

const ThisDevice = () => {
  const { t } = useTranslation()
  return (
    <Chip tone="accent" size="row">
      {t('settings.account.thisDevice')}
    </Chip>
  )
}

// A copy of the account's data, and deleting it.
const DataRows = ({ account }: { account: AccountView }) => {
  const { t } = useTranslation()
  return (
    <>
      <h2 className={styles.label}>{t('settings.account.yourData')}</h2>
      <div className={styles.card}>
        <SettingRow
          label={t('settings.account.copy')}
          hint={t('settings.account.copyHint')}
          action={{
            label: t('settings.account.download'),
            icon: Download,
            onClick: () => window.location.assign(ACCOUNT_COPY_URL)
          }}
        />
        <SettingRow
          label={t('settings.account.delete')}
          hint={t('settings.account.deleteHint')}
          action={{
            label: t('settings.account.deleteButton'),
            look: 'danger',
            icon: Trash2,
            onClick: () => confirmDelete(account, t)
          }}
        />
      </div>
    </>
  )
}

// « Activer »'s QR, then « Nouveaux codes de secours », each shown once.
const TwoFactorDialogs = ({
  account,
  onAccount,
  started,
  onStarted,
  newCodes,
  onNewCodes
}: {
  account: AccountView
  onAccount: (account: AccountView) => void
  started: TwoFactorSecret | null
  onStarted: (started: TwoFactorSecret | null) => void
  newCodes: string[] | null
  onNewCodes: (codes: string[] | null) => void
}) => {
  const { t } = useTranslation()
  return (
    <>
      {started && (
        <TwoFactorDialog
          started={started}
          onClose={() => onStarted(null)}
          onDone={() => {
            onStarted(null)
            setTwoFactorOn(true)
            onAccount({ ...account, twoFactor: { ...account.twoFactor, since: Date.now(), recoveryLeft: 10 } })
            showSaved(t('twoFactor.account.done'))
          }}
        />
      )}
      {newCodes && (
        <RecoveryCodesDialog
          codes={newCodes}
          onDone={() => {
            onNewCodes(null)
            onAccount({ ...account, twoFactor: { ...account.twoFactor, recoveryLeft: newCodes.length } })
          }}
        />
      )}
    </>
  )
}

// Mon compte › Connexion: the password's row, with when it last changed.
const PasswordRow = ({ account, onEdit }: { account: AccountView; onEdit: () => void }) => {
  const { t } = useTranslation()
  return (
    <SettingRow
      label={t('settings.account.password')}
      value={
        account.loginOnly
          ? t('settings.account.noPassword')
          : t('settings.account.passwordChanged', {
              date: numericDate(new Date(account.passwordChangedAt).toISOString())
            })
      }
      action={{
        label: t(account.loginOnly ? 'settings.account.choose' : 'settings.account.change'),
        icon: KeyRound,
        onClick: onEdit
      }}
    />
  )
}

interface PartProps {
  account: AccountView
  onAccount: (account: AccountView) => void
  layout: 'desktop' | 'phone'
}

// Mon compte › Connexion: the e-mail, the password, the profile's lock, the second step, then the devices signed in.
export const SignInPart = ({ account, onAccount, layout }: PartProps) => {
  const { t } = useTranslation()
  const [editing, setEditing] = useState<'email' | 'password' | null>(null)
  // « Activer », once the password was typed: the secret the app scans.
  const [started, setStarted] = useState<TwoFactorSecret | null>(null)
  // « Nouveaux codes de secours », shown once.
  const [newCodes, setNewCodes] = useState<string[] | null>(null)
  const dialogProps = { account, layout, onSaved: onAccount, onClose: () => setEditing(null) }
  return (
    <>
      <div className={styles.card}>
        <SettingRow
          label={t('settings.account.email')}
          value={account.email}
          action={{ label: t('settings.account.change'), icon: Pencil, onClick: () => setEditing('email') }}
        />
        <PasswordRow account={account} onEdit={() => setEditing('password')} />
        <PrivateProfileRow account={account} onAccount={onAccount} />
        <TwoFactorRow account={account} onAccount={onAccount} onStarted={setStarted} onNewCodes={setNewCodes} />
        {/* A plugin's rows about the account (« Relier mon compte Google »). */}
        <PluginSlots slot="accountRows" props={{ layout }} />
      </div>
      <h2 className={styles.label}>{t('settings.account.devices')}</h2>
      <div className={styles.card}>
        <DeviceRows account={account} onAccount={onAccount} thisDevice={<ThisDevice />} />
        <OfflineRow />
      </div>
      {editing === 'email' && <EmailDialog {...dialogProps} />}
      {editing === 'password' && <PasswordDialog {...dialogProps} />}
      <TwoFactorDialogs
        account={account}
        onAccount={onAccount}
        started={started}
        onStarted={setStarted}
        newCodes={newCodes}
        onNewCodes={setNewCodes}
      />
    </>
  )
}

// Mon compte › Données: the household it reads in, a copy of everything, deleting it.
export const DataPart = ({ account }: { account: AccountView }) => (
  <>
    <HouseholdCard account={account} />
    <DataRows account={account} />
  </>
)

// A young profile open on this device has no account of its own: this device's part alone.
export const DevicePart = () => {
  const { t } = useTranslation()
  return (
    <div className={styles.card}>
      <SettingRow label={labelOf(navigator.userAgent, true)} hint={t('settings.account.sessionHint')}>
        <ThisDevice />
      </SettingRow>
      <OfflineRow />
    </div>
  )
}

export { AccountProfile, AccountStatsCard }
