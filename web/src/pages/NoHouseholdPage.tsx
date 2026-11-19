import { ArrowRight, LogOut } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getAccount, logout } from '../api.ts'
import { PluginSlots, useScreenLayout } from '../plugins/Slots.tsx'
import Button from '../ui/Button.tsx'
import DialogActions from '../ui/DialogActions.tsx'
import RichText from '../ui/RichText.tsx'
import RoundButton from '../ui/RoundButton.tsx'
import AccountPage from './AccountPage.tsx'
import { SetupFrame, StepHeader } from './SetupParts.tsx'
import styles from './SetupPage.module.css'

export const signOutHere = async () => {
  await logout()
  window.location.replace('/')
}

// An account in no household any more (its profile was deleted, or it left): on the same card as Connexion, what
// happened and the way to its own account, the only part of Hodi it still reaches.
const NoHouseholdCard = () => {
  const { t } = useTranslation()
  const layout = useScreenLayout()
  const [email, setEmail] = useState('')
  useEffect(() => {
    void getAccount()
      .then(account => setEmail(account?.email ?? ''))
      .catch(() => {})
  }, [])
  return (
    <SetupFrame>
      <div className={styles.form}>
        <StepHeader title={t('noHousehold.title')} intro={<RichText i18nKey="noHousehold.text" values={{ email }} />} />
        {/* A plugin's way on (« Créer mon foyer »): the app starts again on the new household. */}
        <PluginSlots slot="noHouseholdActions" props={{ layout, done: () => window.location.replace('/') }} />
        <DialogActions className={styles.actions}>
          <RoundButton icon={LogOut} label={t('settings.logout')} size={44} onClick={() => void signOutHere()} />
          <span className={styles.spacer} />
          <Button look="primary" href="#/account">
            {t('noHousehold.account')}
            <ArrowRight size={16} aria-hidden="true" />
          </Button>
        </DialogActions>
      </div>
    </SetupFrame>
  )
}

// #/account opens the account itself; any other address, the card.
const NoHouseholdPage = ({ account }: { account: boolean }) => (account ? <AccountPage /> : <NoHouseholdCard />)

export default NoHouseholdPage
