import { KeyRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { type AccountView, newRecoveryCodes, startTwoFactor, stopTwoFactor } from '../../../api.ts'
import { askToConfirm } from '../../../lib/confirm.ts'
import { numericDate } from '../../../lib/format.ts'
import { setTwoFactorOn } from '../../../lib/two-factor.ts'
import Toggle from '../../../ui/Toggle.tsx'
import type { TwoFactorSecret } from '../../account/TwoFactorSetup.tsx'
import SettingRow from '../SettingRow.tsx'

type Setter<T> = (value: T) => void

// What the server makes at once: the row reads « 10 restants sur 10 » right after.
const RECOVERY_CODES = 10

interface TwoFactorRowsProps {
  account: AccountView
  onAccount: Setter<AccountView>
  onStarted: Setter<TwoFactorSecret>
  onNewCodes: Setter<string[]>
}

// The recovery codes left, once the check is on, and new ones after the password and the app's code.
const RecoveryRow = ({ account, onAccount, onNewCodes }: Omit<TwoFactorRowsProps, 'onStarted'>) => {
  const { t } = useTranslation()
  return (
    <SettingRow
      label={t('twoFactor.account.codes')}
      value={t('twoFactor.account.codesLeft', { count: account.twoFactor.recoveryLeft, total: RECOVERY_CODES })}
      action={{
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
              const { recoveryCodes } = await newRecoveryCodes(proof)
              onAccount({ ...account, twoFactor: { ...account.twoFactor, recoveryLeft: recoveryCodes.length } })
              onNewCodes(recoveryCodes)
            }
          })
      }}
    />
  )
}

// « Validation en deux étapes », a switch as any other on/off setting: on asks the password, then the app's QR; off
// asks the password and the app's code. The server's account keeps it on, its switch greyed.
export const TwoFactorRows = ({ account, onAccount, onStarted, onNewCodes }: TwoFactorRowsProps) => {
  const { t } = useTranslation()
  const on = account.twoFactor.since !== null
  const proof = account.loginOnly ? { noPassword: true } : {}
  const turnOn = () =>
    askToConfirm({
      title: t('twoFactor.account.confirmOn.title'),
      message: t('twoFactor.account.confirmOn.message'),
      label: t('twoFactor.account.confirmOn.button'),
      look: 'primary',
      proof,
      onConfirm: async ({ password }) => {
        onStarted(await startTwoFactor(account.loginOnly ? undefined : password))
      }
    })
  const turnOff = () =>
    askToConfirm({
      title: t('twoFactor.account.confirmOff.title'),
      message: t('twoFactor.account.confirmOff.message'),
      label: t('twoFactor.account.confirmOff.button'),
      proof,
      onConfirm: async given => {
        await stopTwoFactor(given)
        setTwoFactorOn(false)
        onAccount({ ...account, twoFactor: { ...account.twoFactor, since: null } })
      }
    })
  return (
    <>
      <SettingRow
        label={t('twoFactor.account.row')}
        value={
          on
            ? t('twoFactor.account.on', { date: numericDate(new Date(account.twoFactor.since!).toISOString()) })
            : t('twoFactor.account.off')
        }
      >
        <Toggle
          label={t('twoFactor.account.row')}
          checked={on}
          disabled={on && account.twoFactor.required}
          onChange={next => (next ? turnOn() : turnOff())}
        />
      </SettingRow>
      {on && <RecoveryRow account={account} onAccount={onAccount} onNewCodes={onNewCodes} />}
    </>
  )
}
