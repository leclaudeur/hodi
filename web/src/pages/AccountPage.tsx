import { ArrowLeft, LogOut } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useIsPhone } from '../lib/use-media.ts'
import Button from '../ui/Button.tsx'
import Copyright from '../ui/Copyright.tsx'
import Logo from '../ui/Logo.tsx'
import RoundButton from '../ui/RoundButton.tsx'
import AccountSection from '../views/settings/sections/AccountSection.tsx'
import { signOutHere } from './NoHouseholdPage.tsx'
import styles from './AccountPage.module.css'

const goBack = () => {
  window.location.hash = '#/'
}

// Mon compte for an account in no household: the app's header (« Retour » to its card, « Se déconnecter ») over the
// same rows as Réglages › Mon compte, whose profile and household parts have nothing to show here.
const AccountPage = () => {
  const { t } = useTranslation()
  const phone = useIsPhone()
  const signOut = () => void signOutHere()
  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <div className={styles.topIn}>
          <Logo size={28} />
          <div className={styles.topActions}>
            {phone ? (
              <>
                <RoundButton icon={ArrowLeft} label={t('common.back')} size={34} onClick={goBack} />
                <RoundButton icon={LogOut} label={t('settings.logout')} size={34} onClick={signOut} />
              </>
            ) : (
              <>
                <Button compact icon={ArrowLeft} onClick={goBack}>
                  {t('common.back')}
                </Button>
                <Button compact icon={LogOut} onClick={signOut}>
                  {t('settings.logout')}
                </Button>
              </>
            )}
          </div>
        </div>
      </header>
      <main className={styles.main}>
        <AccountSection
          layout="desktop"
          intro={t('noHousehold.accountIntro')}
          onUnauthorized={() => window.location.replace('/')}
        />
      </main>
      <footer className={styles.foot}>
        <Copyright />
      </footer>
    </div>
  )
}

export default AccountPage
