import type { TFunction } from 'i18next'
import { type FormEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type LoginResult, getSetup, login } from '../api.ts'
import { setHouseholdLanguage } from '../lib/i18n.ts'
import { refusalText } from '../lib/sign-in-refusal.ts'

type Refused = Extract<LoginResult, { ok: false }>

// A refused sign-in, in words.
const refusalOf = (result: Refused, t: TFunction) => {
  if (result.reason === 'invalid_code') return t('twoFactor.login.wrong')
  if (result.reason === 'invalid_password') return t('login.wrongCredentials')
  if (result.reason === 'too_many_attempts')
    return t('common.tooManyAttempts', { minutes: Math.ceil(result.retryAfterSeconds / 60) })
  if (result.reason === 'refused') return refusalText(result.refusal)
  return t('login.failed')
}

// What the server says before anything is typed: the household's name and language, and whether Serveur › E-mail
// can send a new password's link. Not ready until it answered, so no text changes under the person.
export const useSignInPage = () => {
  const [ready, setReady] = useState(false)
  // The household's name, under the logo once known.
  const [name, setName] = useState<string | null>(null)
  const [resetByMail, setResetByMail] = useState(false)
  useEffect(() => {
    getSetup()
      .then(state => {
        setReady(true)
        if (state.needed) return
        setName(state.name)
        setResetByMail(state.resetByMail === true)
        if (state.language) setHouseholdLanguage(state.language)
      })
      .catch(() => setReady(true))
  }, [])
  return { ready, name, resetByMail }
}

// The e-mail and password, then with « Validation en deux étapes » the app's code (or a recovery code).
export const useLogin = (onLoggedIn: () => void) => {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [secondStep, setSecondStep] = useState<'app' | 'recovery' | null>(null)
  const [code, setCode] = useState('')

  const submit = async (event?: FormEvent<HTMLFormElement>, typed = code) => {
    event?.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const result = await login(email, password, secondStep ? typed : undefined)
      if (result.ok) {
        onLoggedIn()
        return
      }
      if (result.reason === 'two_factor') setSecondStep('app')
      else setError(refusalOf(result, t))
    } catch {
      setError(t('common.unreachable'))
    } finally {
      setSubmitting(false)
    }
  }

  // Another way of the second step, or back to the password: what was typed goes.
  const switchStep = (next: 'app' | 'recovery' | null) => {
    setCode('')
    setError(null)
    setSecondStep(next)
  }

  return {
    ...{ email, setEmail, password, setPassword, error, setError, submitting, secondStep, code, setCode },
    ...{ submit, switchStep }
  }
}

export type Login = ReturnType<typeof useLogin>
