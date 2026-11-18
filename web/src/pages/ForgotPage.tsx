import type { TFunction } from 'i18next'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RequestError, askResetCode, checkResetCode, resetWithMailedCode } from '../api.ts'
import { refusalText } from '../lib/sign-in-refusal.ts'
import { showSaved } from '../lib/toast.ts'
import { AskForm, CodeForm, DoneStep, NewPasswordForm } from './ForgotSteps.tsx'
import { SetupFrame } from './SetupParts.tsx'

// The e-mail's button: the Connexion page opens on « Entre le code », filled in.
export const RESET_LINK = /^#\/reset\/([A-HJKMNP-Z2-9]{8})$/

interface ForgotPageProps {
  // From the e-mail's button: its code, checked at once.
  token?: string
  // Back to the Connexion page.
  onBack: () => void
  // The new password is set and this device signed in with it.
  // signedIn false: the account asks for its app's code, so the device signs in on Connexion.
  onDone: (signedIn: boolean) => void
}

type Step = 'ask' | 'code' | 'password' | 'done'

const refusalOf = (failure: unknown, t: TFunction) => {
  if (!(failure instanceof RequestError)) return t('common.unreachable')
  if (failure.refusal) return refusalText(failure.refusal)
  if (failure.code === 'too_many_attempts' && failure.retryAfterSeconds)
    return t('common.tooManyAttempts', { minutes: Math.ceil(failure.retryAfterSeconds / 60) })
  if (failure.code === 'invalid_code') return t('forgot.wrongCode')
  return t('forgot.failed')
}

// What is being typed, and where it stands.
const useForgot = (token: string | undefined) => {
  const { t } = useTranslation()
  const [step, setStep] = useState<Step>(token ? 'code' : 'ask')
  const [email, setEmail] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [code, setCode] = useState(token ?? '')
  const [account, setAccount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Each step's call: busy meanwhile, its refusal under the field.
  const run = async (call: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await call()
    } catch (failure) {
      setError(refusalOf(failure, t))
    }
    setBusy(false)
  }

  const ask = (again = false) =>
    run(async () => {
      await askResetCode(email.trim())
      setSentTo(email.trim())
      setCode('')
      setStep('code')
      if (again) showSaved(t('forgot.resent', { email: email.trim() }))
    })

  const check = () =>
    run(async () => {
      setAccount((await checkResetCode(code)).email)
      setStep('password')
    })

  return { step, setStep, email, setEmail, sentTo, code, setCode, account, busy, error, setError, run, ask, check }
}

// « Mot de passe oublié »: the account's e-mail, the code sent to it, the new password, and done.
const ForgotPage = ({ token, onBack, onDone }: ForgotPageProps) => {
  const forgot = useForgot(token)
  const { step, setStep, busy, error, setError, run } = forgot
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')

  // From the e-mail's button: the code is checked at once.
  useEffect(() => {
    if (token) void forgot.check()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, for the code the page opened with
  }, [token])

  const save = () =>
    run(async () => {
      const answer = await resetWithMailedCode(forgot.code, password)
      if (answer?.signIn === false) onDone(false)
      else setStep('done')
    })

  const goTo = (next: Step) => {
    setError(null)
    setStep(next)
  }

  let content
  if (step === 'done') content = <DoneStep onEnter={() => onDone(true)} />
  else if (step === 'password')
    content = (
      <NewPasswordForm
        account={forgot.account}
        password={password}
        confirm={confirm}
        setPassword={setPassword}
        setConfirm={setConfirm}
        error={error}
        busy={busy}
        onSave={() => void save()}
        onBack={onBack}
      />
    )
  else if (step === 'code')
    content = (
      <CodeForm
        sentTo={forgot.sentTo}
        code={forgot.code}
        setCode={forgot.setCode}
        error={error}
        busy={busy}
        onCheck={() => void forgot.check()}
        onResend={() => void forgot.ask(true)}
        onBack={() => goTo('ask')}
      />
    )
  else
    content = (
      <AskForm
        email={forgot.email}
        setEmail={forgot.setEmail}
        error={error}
        busy={busy}
        onAsk={() => void forgot.ask()}
        onHaveCode={() => goTo('code')}
        onBack={onBack}
      />
    )

  return <SetupFrame>{content}</SetupFrame>
}

export default ForgotPage
