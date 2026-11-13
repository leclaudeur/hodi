import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Copyright from '../ui/Copyright.tsx'
import PageGlows from '../ui/PageGlows.tsx'
import ForgotPage, { RESET_LINK } from './ForgotPage.tsx'
import JoinPage, { CODE_LINK } from './JoinPage.tsx'
import { SecondStepForm, SignInForm } from './LoginForms.tsx'
import styles from './LoginPage.module.css'
import { useLogin, useSignInPage } from './use-login.ts'

interface LoginPageProps {
  onLoggedIn: () => void
}

// The only way in, from the charter's "Connexion" boards: the person's e-mail and password, remembered on this
// device.
const LoginPage = ({ onLoggedIn }: LoginPageProps) => {
  const { t } = useTranslation()
  const { ready, name, resetByMail } = useSignInPage()
  const login = useLogin(onLoggedIn)
  // "J'ai un code": open from the button, or at once from a code's link, filled in.
  const [joining, setJoining] = useState(() => CODE_LINK.test(window.location.hash))
  const [linkCode] = useState(() => CODE_LINK.exec(window.location.hash)?.[1])
  // « Mot de passe oublié »: open from the link under the form, or at once from the e-mail's link.
  const [resetToken] = useState(() => RESET_LINK.exec(window.location.hash)?.[1])
  const [forgot, setForgot] = useState(resetToken !== undefined)
  // Back from « J'ai un code » or a new password, for an account that asks for its app's code: it signs in here.
  const [notice, setNotice] = useState<string | null>(null)
  const done = (signedIn: boolean) => {
    window.history.replaceState(null, '', '/')
    if (signedIn) {
      onLoggedIn()
      return
    }
    setJoining(false)
    setForgot(false)
    setNotice(t('twoFactor.login.signInNow'))
  }

  if (forgot) {
    return (
      <ForgotPage
        token={resetToken}
        onBack={() => {
          setForgot(false)
          if (RESET_LINK.test(window.location.hash)) window.history.replaceState(null, '', '/')
        }}
        onDone={done}
      />
    )
  }

  if (joining) {
    return (
      <JoinPage
        initialCode={linkCode}
        onBack={() => {
          setJoining(false)
          if (CODE_LINK.test(window.location.hash)) window.history.replaceState(null, '', '/')
        }}
        // The app opens on its first page, not on the code's link.
        onDone={done}
      />
    )
  }

  // The page's background alone for the moment the server takes to say what it asks, so no field jumps in.
  if (!ready)
    return (
      <main className={styles.page}>
        <PageGlows />
      </main>
    )

  return (
    <main className={styles.page}>
      <PageGlows />
      {login.secondStep ? (
        <SecondStepForm login={login} />
      ) : (
        <SignInForm
          login={login}
          name={name}
          notice={notice}
          resetByMail={resetByMail}
          onJoin={() => setJoining(true)}
          onForgot={() => setForgot(true)}
          onLoggedIn={onLoggedIn}
        />
      )}
      <Copyright />
    </main>
  )
}

export default LoginPage
