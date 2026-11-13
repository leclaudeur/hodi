import { ArrowLeft, ArrowRight, KeyRound, LifeBuoy, LockKeyhole, Mail } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PluginSlots, useScreenLayout } from '../plugins/Slots.tsx'
import Button from '../ui/Button.tsx'
import Logo from '../ui/Logo.tsx'
import PasswordField from '../ui/PasswordField.tsx'
import PinField from '../ui/PinField.tsx'
import StatusLine from '../ui/StatusLine.tsx'
import TextField from '../ui/TextField.tsx'
import { TWO_FACTOR_CODE_LENGTH } from '../views/account/TwoFactorSetup.tsx'
import styles from './LoginPage.module.css'
import type { Login } from './use-login.ts'

// The app's code in its boxes, or a recovery code in a field.
const SecondField = ({ login, recovery }: { login: Login; recovery: boolean }) => {
  const { t } = useTranslation()
  if (recovery) {
    return (
      <TextField
        icon={KeyRound}
        autoComplete="one-time-code"
        autoFocus
        required
        aria-label={t('twoFactor.login.recoveryLabel')}
        placeholder={t('twoFactor.login.recoveryLabel')}
        value={login.code}
        onChange={event => login.setCode(event.target.value)}
        aria-invalid={login.error !== null}
      />
    )
  }
  return (
    <PinField
      label={t('twoFactor.login.code')}
      length={TWO_FACTOR_CODE_LENGTH}
      masked={false}
      autoFocus
      disabled={login.submitting}
      state={login.error ? 'wrong' : 'idle'}
      value={login.code}
      onChange={typed => {
        login.setCode(typed)
        login.setError(null)
      }}
      onComplete={typed => void login.submit(undefined, typed)}
    />
  )
}

// « Validation en deux étapes »: the password was right, the app's code (or a recovery code) comes next.
export const SecondStepForm = ({ login }: { login: Login }) => {
  const { t } = useTranslation()
  const recovery = login.secondStep === 'recovery'
  const { code, error, submitting } = login
  return (
    <form className={styles.form} onSubmit={event => void login.submit(event)}>
      <h1 className={styles.title}>
        <Logo size={72} />
      </h1>
      <p className={`${styles.subtitle} ${styles.stepTitle}`}>{t('twoFactor.login.title')}</p>
      <p className={styles.secondIntro}>{t(recovery ? 'twoFactor.login.recoveryIntro' : 'twoFactor.login.intro')}</p>
      <div className={styles.field}>
        <SecondField login={login} recovery={recovery} />
      </div>
      {error && (
        <span className={styles.error}>
          <StatusLine tone="error">{error}</StatusLine>
        </span>
      )}
      <Button
        type="submit"
        look="primary"
        wide
        busy={submitting}
        disabled={recovery ? code.trim() === '' : code.length !== TWO_FACTOR_CODE_LENGTH}
        className={styles.submit}
      >
        {t('login.enter')}
        {!submitting && <ArrowRight size={16} aria-hidden="true" />}
      </Button>
      <div className={styles.links}>
        <a
          href="#/"
          className={styles.code}
          onClick={event => {
            event.preventDefault()
            login.switchStep(recovery ? 'app' : 'recovery')
          }}
        >
          <LifeBuoy size={14} aria-hidden="true" />
          {t(recovery ? 'twoFactor.login.useApp' : 'twoFactor.login.recovery')}
        </a>
        <a
          href="#/"
          className={styles.code}
          onClick={event => {
            event.preventDefault()
            login.switchStep(null)
          }}
        >
          <ArrowLeft size={14} aria-hidden="true" />
          {t('twoFactor.login.back')}
        </a>
      </div>
    </form>
  )
}

// The error, or else the note from a step that ended here.
const Status = ({ error, notice }: { error: string | null; notice: string | null }) => {
  if (error) {
    return (
      <span id="login-error" className={styles.error}>
        <StatusLine tone="error">{error}</StatusLine>
      </span>
    )
  }
  return (
    notice && (
      <span className={styles.error}>
        <StatusLine tone="info">{notice}</StatusLine>
      </span>
    )
  )
}

interface SignInFormProps {
  login: Login
  name: string | null
  notice: string | null
  resetByMail: boolean
  onJoin: () => void
  onForgot: () => void
  onLoggedIn: () => void
}

// The e-mail and password, and the other ways in under them.
export const SignInForm = ({ login, name, notice, resetByMail, onJoin, onForgot, onLoggedIn }: SignInFormProps) => {
  const { t } = useTranslation()
  const layout = useScreenLayout()
  const { error, submitting } = login
  return (
    <form className={styles.form} onSubmit={event => void login.submit(event)}>
      <h1 className={styles.title}>
        <Logo size={72} />
      </h1>
      <p className={styles.subtitle}>{name ?? t('login.tagline')}</p>

      <div className={styles.field}>
        <TextField
          icon={Mail}
          type="email"
          autoComplete="username"
          autoFocus
          required
          value={login.email}
          onChange={event => login.setEmail(event.target.value)}
          aria-label={t('login.email')}
          placeholder={t('login.email')}
          aria-invalid={error !== null}
        />
      </div>

      <PasswordField
        className={styles.nextField}
        autoComplete="current-password"
        required
        placeholder={t('login.password')}
        value={login.password}
        onChange={event => login.setPassword(event.target.value)}
        aria-label={t('login.password')}
        invalid={error !== null}
        aria-describedby={error ? 'login-error' : undefined}
      />

      <Status error={error} notice={notice} />

      <Button type="submit" look="primary" wide busy={submitting} className={styles.submit}>
        {submitting ? t('login.signingIn') : t('login.enter')}
        {!submitting && <ArrowRight size={16} aria-hidden="true" />}
      </Button>

      {/* Links, not buttons: the ways in for whoever has no account yet or lost its password, under the one
          that signs in. */}
      <div className={styles.links}>
        <a
          href="#/code"
          className={styles.code}
          onClick={event => {
            event.preventDefault()
            onJoin()
          }}
        >
          <KeyRound size={14} aria-hidden="true" />
          {t('login.haveCode')}
        </a>
        {resetByMail && (
          <a
            href="#/forgot"
            className={styles.code}
            onClick={event => {
              event.preventDefault()
              onForgot()
            }}
          >
            <LockKeyhole size={14} aria-hidden="true" />
            {t('login.forgot')}
          </a>
        )}
      </div>
      {/* A plugin's other ways in (« Créer mon foyer »), under Hodi's. */}
      <PluginSlots slot="signInExtras" props={{ layout, signedIn: onLoggedIn }} />
    </form>
  )
}
