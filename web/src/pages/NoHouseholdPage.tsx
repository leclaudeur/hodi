import { DoorOpen, Download, LogOut, Trash2 } from 'lucide-react'
import type { TFunction } from 'i18next'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ACCOUNT_COPY_URL, type AccountView, deleteAccount, getAccount, logout } from '../api.ts'
import { askToConfirm } from '../lib/confirm.ts'
import { contentDays } from '../lib/content-days.ts'
import Button from '../ui/Button.tsx'
import Copyright from '../ui/Copyright.tsx'
import PhoneHeader from '../ui/PhoneHeader.tsx'
import RichText from '../ui/RichText.tsx'
import pickerStyles from './ProfilePicker.module.css'
import styles from './NoHouseholdPage.module.css'

// The account goes alone: its profile already left with the household's choice.
const confirmDelete = (account: AccountView, t: TFunction) =>
  askToConfirm({
    title: t('confirm.deleteAccount.title'),
    message: (
      <RichText
        i18nKey="noHousehold.deleteMessage"
        values={{ email: account.email, days: t('count.day', { count: contentDays().backupCopies }) }}
      />
    ),
    label: t('confirm.deleteAccount.button'),
    proof: account.loginOnly ? { noPassword: true } : {},
    onConfirm: async proof => {
      await deleteAccount(proof)
      window.location.replace('/')
    }
  })

// An account whose profile was deleted from its household: the account is still the person's, the household no
// longer. The same calm page as "À demain": what happened, then its own data to take or delete, or signing out.
const NoHouseholdPage = () => {
  const { t } = useTranslation()
  const [account, setAccount] = useState<AccountView | null>(null)
  useEffect(() => {
    void getAccount()
      .then(setAccount)
      .catch(() => {})
  }, [])
  const signOut = async () => {
    await logout()
    window.location.replace('/')
  }

  return (
    <main className={pickerStyles.page}>
      <PhoneHeader logo className={pickerStyles.header} />
      <div className={`${pickerStyles.content} ${styles.content}`}>
        <span className={styles.icon}>
          <DoorOpen size={44} strokeWidth={1.5} />
        </span>
        <h1 className={`${pickerStyles.title} ${styles.title}`}>{t('noHousehold.title')}</h1>
        <p className={styles.text}>{t('noHousehold.text')}</p>
        {account && <p className={styles.email}>{account.email}</p>}
        <div className={styles.actions}>
          <Button icon={Download} onClick={() => window.location.assign(ACCOUNT_COPY_URL)}>
            {t('settings.account.copy')}
          </Button>
          <Button icon={Trash2} look="danger" disabled={!account} onClick={() => account && confirmDelete(account, t)}>
            {t('settings.account.delete')}
          </Button>
          <Button icon={LogOut} onClick={() => void signOut()}>
            {t('settings.logout')}
          </Button>
        </div>
      </div>
      <Copyright />
    </main>
  )
}

export default NoHouseholdPage
