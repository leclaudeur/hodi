import type { TFunction } from 'i18next'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  type CodeUse,
  RequestError,
  SIGN_IN_CODE_LENGTH,
  checkSignInCode,
  joinWithCode,
  resetWithCode,
  uploadProfilePhoto
} from '../api.ts'
import { EMAIL_PATTERN } from '../lib/email.ts'
import { passwordStrength } from '../lib/password-strength.ts'
import { refusalText } from '../lib/sign-in-refusal.ts'
import type { ProfileDraft } from '../views/profiles/ProfileForm.tsx'

export type JoinStep = 'code' | 'account' | 'who'

// What the server refused, in words.
const refusalOf = (failure: unknown, t: TFunction) => {
  if (!(failure instanceof RequestError)) return t('common.unreachable')
  if (failure.refusal) return refusalText(failure.refusal)
  if (failure.code === 'too_many_attempts' && failure.retryAfterSeconds) {
    return t('common.tooManyAttempts', { minutes: Math.ceil(failure.retryAfterSeconds / 60) })
  }
  if (failure.code === 'email_taken') return t('join.emailTaken')
  if (failure.code === 'blocked') return t('login.blocked')
  if (failure.code === 'invalid_code') return t('join.code.wrong')
  return t('join.failed')
}

// A taken address is fixed on the account's screen.
const fixedOnAccount = (failure: unknown) => failure instanceof RequestError && failure.code === 'email_taken'

// The fields the person fills in along the way.
const useJoinFields = () => {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [age, setAge] = useState(false)
  const passwordReady = passwordStrength(password).score > 0 && password === confirm
  const accountReady = EMAIL_PATTERN.test(email.trim()) && passwordReady && age
  return {
    ...{ email, setEmail, password, setPassword, confirm, setConfirm, age, setAge },
    ...{ passwordReady, accountReady }
  }
}

// The steps of "J'ai un code" and what each one sends.
export const useJoin = (initialCode: string, onDone: (signedIn: boolean) => void) => {
  const { t } = useTranslation()
  const fields = useJoinFields()
  const [step, setStep] = useState<JoinStep>('code')
  const [code, setCode] = useState(initialCode)
  const [use, setUse] = useState<CodeUse | null>(null)
  const [busy, setBusy] = useState(false)
  const [codeWrong, setCodeWrong] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checkedInitial, setCheckedInitial] = useState(false)

  // Sends one request: busy meanwhile, and its refusal in words.
  const send = async (request: () => Promise<void>, onRefused?: (failure: unknown) => void) => {
    setBusy(true)
    setError(null)
    try {
      await request()
    } catch (failure) {
      onRefused?.(failure)
      setError(refusalOf(failure, t))
      setBusy(false)
    }
  }

  const check = async (typed: string) => {
    await send(
      async () => {
        setUse(await checkSignInCode(typed))
        setStep('account')
        setBusy(false)
      },
      failure => setCodeWrong(failure instanceof RequestError && failure.code === 'invalid_code')
    )
  }

  // A code from a link is checked as the page opens, once.
  if (!checkedInitial && initialCode.length === SIGN_IN_CODE_LENGTH) {
    setCheckedInitial(true)
    void check(initialCode)
  }

  // An invitation code always makes a new account, with the profile it was invited for or the one drafted ("who").
  const join = (profile?: ProfileDraft) =>
    send(
      async () => {
        const joined = await joinWithCode({
          code,
          email: fields.email.trim(),
          password: fields.password,
          ageConfirmed: true,
          ...(profile ? { profile: { name: profile.name, color: profile.color, handle: profile.handle } } : {})
        })
        const { profileId, signIn } = joined
        // The photo once the profile is open; the account is made whatever happens to it.
        if (profile?.photo && signIn !== false) await uploadProfilePhoto(profileId, profile.photo).catch(() => {})
        onDone(signIn !== false)
      },
      failure => fixedOnAccount(failure) && setStep('account')
    )

  const reset = () =>
    send(async () => {
      const { signIn } = await resetWithCode(code, fields.password)
      onDone(signIn !== false)
    })

  const back = () => {
    setStep('code')
    setUse(null)
    setError(null)
  }

  return {
    ...{ fields, step, setStep, code, setCode, use, busy, codeWrong, setCodeWrong, error, setError },
    ...{ check, join, reset, back }
  }
}

export type Join = ReturnType<typeof useJoin>
