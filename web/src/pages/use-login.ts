import type { TFunction } from 'i18next'
import { type FormEvent, type ReactNode, createElement, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type LoginResult, getSetup, login } from '../api.ts'
import { setHouseholdLanguage } from '../lib/i18n.ts'
import { publicHomeFor } from '../lib/public-home.ts'
import { refusalText } from '../lib/sign-in-refusal.ts'
import RichText from '../ui/RichText.tsx'

type Refused = Extract<LoginResult, { ok: false }>

// A refused sign-in, in words.
const refusalOf = (result: Refused, t: TFunction, email: string): ReactNode => {
  if (result.reason === 'other_household')
    return createElement(RichText, {
      i18nKey: 'profiles.addAccount.otherHousehold',
      values: { email, household: result.household ?? '', here: result.here ?? '' }
    })
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
        const home = state.needed ? null : publicHomeFor(state.publicHome, window.location)
        // Not ready: the site opens in its place, without Connexion showing first.
        if (home) return window.location.replace(home)
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
  const [error, setError] = useState<ReactNode>(null)
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
      else setError(refusalOf(result, t, email))
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
