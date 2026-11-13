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
import SectionPage from '../SectionPage.tsx'
import RowsSkeleton from '../SettingsSkeleton.tsx'
import SettingRow from '../SettingRow.tsx'
import styles from '../Settings.module.css'
import { PluginSlots } from '../../../plugins/Slots.tsx'
import { DeviceRows, TwoFactorRow, confirmDelete, labelOf } from './AccountRows.tsx'

// undefined while it comes; null: no account here.
const useAccount = (onUnauthorized: () => void) => {
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

interface AccountSectionProps {
  layout: 'desktop' | 'phone'
  onUnauthorized: () => void
}

// Réglages > Compte et données: the account's e-mail and password, the devices signed in with it (this one's offline
// reading among them), a copy of its data and deleting it. An install still on the household's password, or a young
// profile open on this device, sees this device's part alone.
const AccountSection = ({ layout, onUnauthorized }: AccountSectionProps) => {
  const { t } = useTranslation()
  const [account, setAccount] = useAccount(onUnauthorized)
  const [editing, setEditing] = useState<'email' | 'password' | null>(null)
  // « Activer », once the password was typed: the secret the app scans.
  const [started, setStarted] = useState<TwoFactorSecret | null>(null)
  // « Nouveaux codes de secours », shown once.
  const [newCodes, setNewCodes] = useState<string[] | null>(null)

  const title = t('settings.nav.account')
  if (account === undefined) {
    return (
      <SectionPage title={title} intro={t('settings.account.intro')} layout={layout}>
        <RowsSkeleton rows={2} end="button" />
      </SectionPage>
    )
  }

  const offlineRow = <OfflineRow />
  const thisDeviceChip = <ThisDevice />

  if (account === null) {
    return (
      <SectionPage title={title} intro={t('settings.account.deviceIntro')} layout={layout}>
        <h2 className={styles.label}>{t('settings.account.devices')}</h2>
        <div className={styles.card}>
          <SettingRow label={labelOf(navigator.userAgent, true)} hint={t('settings.account.sessionHint')}>
            {thisDeviceChip}
          </SettingRow>
          {offlineRow}
        </div>
      </SectionPage>
    )
  }

  const dialogProps = { account, layout, onSaved: setAccount, onClose: () => setEditing(null) }

  return (
    <SectionPage title={title} intro={t('settings.account.intro')} layout={layout}>
      <h2 className={styles.label}>{t('settings.account.yourAccount')}</h2>
      <div className={styles.card}>
        <SettingRow
          label={t('settings.account.email')}
          value={account.email}
          action={{ label: t('settings.account.change'), icon: Pencil, onClick: () => setEditing('email') }}
        />
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
            onClick: () => setEditing('password')
          }}
        />
        <TwoFactorRow account={account} onAccount={setAccount} onStarted={setStarted} onNewCodes={setNewCodes} />
        {/* A plugin's rows about the account (« Relier mon compte Google »). */}
        <PluginSlots slot="accountRows" props={{ layout }} />
      </div>

      <h2 className={styles.label}>{t('settings.account.devices')}</h2>
      <div className={styles.card}>
        <DeviceRows account={account} onAccount={setAccount} thisDevice={thisDeviceChip} />
        {offlineRow}
      </div>

      <DataRows account={account} />

      {editing === 'email' && <EmailDialog {...dialogProps} />}
      {editing === 'password' && <PasswordDialog {...dialogProps} />}
      <TwoFactorDialogs
        account={account}
        onAccount={setAccount}
        started={started}
        onStarted={setStarted}
        newCodes={newCodes}
        onNewCodes={setNewCodes}
      />
    </SectionPage>
  )
}

export default AccountSection
