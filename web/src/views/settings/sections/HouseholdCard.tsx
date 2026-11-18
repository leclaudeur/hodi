import { DoorOpen } from 'lucide-react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { type AccountView, leaveHousehold } from '../../../api.ts'
import { askToConfirm } from '../../../lib/confirm.ts'
import RichText from '../../../ui/RichText.tsx'
import SettingRow from '../SettingRow.tsx'
import styles from '../Settings.module.css'

type Deletion = NonNullable<AccountView['deletion']>

// Its password first, as deleting the account: a device left open is not enough to take a profile away.
const confirmLeave = (account: AccountView, deletion: Deletion, t: TFunction) =>
  askToConfirm({
    title: t('confirm.leaveHousehold.title', { name: deletion.household }),
    message: (
      <RichText
        i18nKey={
          deletion.admin && deletion.heir ? 'confirm.leaveHousehold.messageAdmin' : 'confirm.leaveHousehold.message'
        }
        values={{ name: deletion.household, email: account.email, heir: deletion.heir ?? '' }}
      />
    ),
    label: t('confirm.leaveHousehold.button'),
    proof: account.loginOnly ? { noPassword: true } : {},
    onConfirm: async proof => {
      await leaveHousehold(proof)
      // The app starts again on the screen of an account with no household.
      window.location.replace('/')
    }
  })

// Mon compte › Foyer: one account reads in one household. The last adult with an account cannot leave it: no one
// could open it any more, so deleting the account is that way out.
const HouseholdCard = ({ account }: { account: AccountView }) => {
  const { t } = useTranslation()
  const deletion = account.deletion
  if (!deletion?.member) return null
  const role = t(deletion.admin ? 'settings.account.householdAdmin' : 'settings.account.householdMember')
  return (
    <>
      <h2 className={styles.label}>{t('settings.account.household')}</h2>
      <div className={styles.card}>
        <SettingRow
          label={deletion.household}
          value={deletion.householdGoes ? t('settings.account.lastAdult', { role }) : role}
          action={
            deletion.householdGoes
              ? undefined
              : {
                  label: t('settings.account.leave'),
                  look: 'danger',
                  icon: DoorOpen,
                  onClick: () => confirmLeave(account, deletion, t)
                }
          }
        />
      </div>
    </>
  )
}

export default HouseholdCard
