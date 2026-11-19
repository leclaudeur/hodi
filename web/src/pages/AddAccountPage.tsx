import { ArrowRight, LifeBuoy, Mail, Smartphone } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getSetup } from '../api.ts'
import Button from '../ui/Button.tsx'
import PasswordField from '../ui/PasswordField.tsx'
import RichText from '../ui/RichText.tsx'
import StatusLine from '../ui/StatusLine.tsx'
import TextField from '../ui/TextField.tsx'
import householdStyles from '../views/household/Household.module.css'
import { TWO_FACTOR_CODE_LENGTH } from '../views/account/TwoFactorSetup.tsx'
import { SecondField } from './LoginForms.tsx'
import { Actions, SetupFrame, StepHeader } from './SetupParts.tsx'
import setup from './SetupPage.module.css'
import { type Login, useLogin } from './use-login.ts'

// The household this device serves, for the intro.
const useHouseholdName = () => {
  const [name, setName] = useState('')
  useEffect(() => {
    getSetup()
      .then(state => setName(state.needed ? '' : (state.name ?? '')))
      .catch(() => {})
  }, [])
  return name
}

const Fields = ({ login }: { login: Login }) => {
  const { t } = useTranslation()
  return (
    <>
      <label className={householdStyles.field}>
        <span className={householdStyles.fieldLabel}>{t('setup.account.email')}</span>
        <TextField
          icon={Mail}
          type="email"
          autoComplete="username"
          aria-label={t('setup.account.email')}
          placeholder={t('setup.account.emailPlaceholder')}
          autoFocus
          required
          value={login.email}
          onChange={event => {
            login.setEmail(event.target.value)
            login.setError(null)
          }}
        />
      </label>
      <div className={householdStyles.field}>
        <span className={householdStyles.fieldLabel}>{t('setup.account.password')}</span>
        <PasswordField
          aria-label={t('setup.account.password')}
          autoComplete="current-password"
          required
          value={login.password}
          onChange={event => {
            login.setPassword(event.target.value)
            login.setError(null)
          }}
        />
      </div>
    </>
  )
}

// « Validation en deux étapes » of the account added: its app's code, or a recovery code.
const SecondStep = ({ login, onBack }: { login: Login; onBack: () => void }) => {
  const { t } = useTranslation()
  const recovery = login.secondStep === 'recovery'
  return (
    <>
      <StepHeader
        title={t('twoFactor.login.title')}
        intro={t(recovery ? 'twoFactor.login.recoveryIntro' : 'twoFactor.login.intro')}
      />
      <div className={householdStyles.field}>
        <SecondField login={login} recovery={recovery} />
      </div>
      {login.error && <StatusLine tone="error">{login.error}</StatusLine>}
      <Actions
        onBack={onBack}
        start={
          <Button
            icon={recovery ? Smartphone : LifeBuoy}
            onClick={() => login.switchStep(recovery ? 'app' : 'recovery')}
          >
            {t(recovery ? 'profiles.addAccount.app' : 'profiles.addAccount.recovery')}
          </Button>
        }
      >
        <Button
          type="submit"
          look="primary"
          busy={login.submitting}
          disabled={recovery ? login.code.trim() === '' : login.code.length !== TWO_FACTOR_CODE_LENGTH}
        >
          {t('profiles.addAccount.submit')}
          {!login.submitting && <ArrowRight size={16} aria-hidden="true" />}
        </Button>
      </Actions>
    </>
  )
}

// « Ajouter » in « Qui lit ? »: one more account on this device, beside the ones already signed in. Its profile opens
// once it is in; an account of another household is refused, the device serving one.
const AddAccountPage = ({ onBack }: { onBack: () => void }) => {
  const { t } = useTranslation()
  const name = useHouseholdName()
  // The device starts again on the feed, with the new session and its own profile open.
  const login = useLogin(() => window.location.replace('/'))
  return (
    <SetupFrame>
      <form className={setup.form} onSubmit={event => void login.submit(event)}>
        {login.secondStep ? (
          <SecondStep login={login} onBack={() => login.switchStep(null)} />
        ) : (
          <>
            <StepHeader
              title={t('profiles.addAccount.title')}
              intro={<RichText i18nKey="profiles.addAccount.intro" values={{ household: name }} />}
            />
            <Fields login={login} />
            {login.error && <StatusLine tone="error">{login.error}</StatusLine>}
            <Actions onBack={onBack}>
              <Button type="submit" look="primary" busy={login.submitting}>
                {t('profiles.addAccount.submit')}
                {!login.submitting && <ArrowRight size={16} aria-hidden="true" />}
              </Button>
            </Actions>
          </>
        )}
      </form>
    </SetupFrame>
  )
}

export default AddAccountPage
