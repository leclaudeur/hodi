import { ArrowRight } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getSetup, login } from '../api.ts'
import { setHouseholdLanguage } from '../lib/i18n.ts'
import Button from '../ui/Button.tsx'
import Copyright from '../ui/Copyright.tsx'
import Logo from '../ui/Logo.tsx'
import PasswordField from '../ui/PasswordField.tsx'
import StatusLine from '../ui/StatusLine.tsx'
import styles from './LoginPage.module.css'

interface LoginPageProps {
  onLoggedIn: () => void
}

// The only way in, from the charter's "Connexion" boards: the household's password, remembered on this device.
const LoginPage = ({ onLoggedIn }: LoginPageProps) => {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  // The household's name, under the logo once known.
  const [name, setName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    getSetup()
      .then(state => {
        if (state.needed) return
        setName(state.name)
        if (state.language) setHouseholdLanguage(state.language)
      })
      .catch(() => {})
  }, [])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      const result = await login(password)

      if (result.ok) {
        onLoggedIn()
        return
      }

      if (result.reason === 'invalid_password') {
        setError(t('login.wrongPassword'))
      } else if (result.reason === 'too_many_attempts') {
        setError(t('common.tooManyAttempts', { minutes: Math.ceil(result.retryAfterSeconds / 60) }))
      } else {
        setError(t('login.failed'))
      }
    } catch {
      setError(t('common.unreachable'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className={styles.page}>
      <form className={styles.form} onSubmit={handleSubmit}>
        <h1 className={styles.title}>
          <Logo size={72} />
        </h1>
        <p className={styles.subtitle}>{name ?? t('login.tagline')}</p>

        <PasswordField
          className={styles.field}
          autoComplete="current-password"
          autoFocus
          required
          value={password}
          onChange={event => setPassword(event.target.value)}
          aria-label={t('login.password')}
          invalid={error !== null}
          aria-describedby={error ? 'login-error' : undefined}
        />

        {error && (
          <span id="login-error" className={styles.error}>
            <StatusLine tone="error">{error}</StatusLine>
          </span>
        )}

        <Button type="submit" look="primary" wide busy={submitting} className={styles.submit}>
          {submitting ? t('login.signingIn') : t('login.enter')}
          {!submitting && <ArrowRight size={16} aria-hidden="true" />}
        </Button>
      </form>
      <Copyright />
    </main>
  )
}

export default LoginPage
