import { type Dispatch, type SetStateAction, useEffect, useState } from 'react'
import { type KeyCheck, RequestError, type SetupState } from '../../api.ts'
import { t as textNow } from '../../lib/i18n.ts'
import { EMAIL_PATTERN } from '../../lib/email.ts'
import { passwordStrength } from '../../lib/password-strength.ts'
import { type SetupDraft, blobOf } from '../../lib/setup-draft.ts'
import { deviceCountry, deviceTimeZone, timeZoneCountry } from '../../lib/regions.ts'
import type { ProfileDraft } from '../../views/profiles/ProfileForm.tsx'
import { NO_AI } from './AiStep.tsx'

// 0: welcome (and the code, away from the server); 1, then 3 to 5: the server admin's account, its profile, AI, recap
// (2, where the household was named, opens the profile). 6: « Le serveur est prêt », between the account and the
// profile, with no number: the profile now, or the server's space first. 7: « Plugins trouvés », right after the
// account when plugins were put in data/plugins before the first start, with no number either. The account is the
// same start with or without plugins. 8: the steps of the plugins turned on there, numbered after the account: the
// profile's steps come after them in the count.
export type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
export const STEPS = 4
export const HOUSEHOLD_STEP = 2
// The first step once the account exists.
export const READY_STEP = 6
export const PLUGINS_STEP = 7
export const PLUGIN_STEPS = 8
// « Créer mon profil » from Serveur: straight to the profile.
export const HOUSEHOLD_LINK = '#/household'

export type NeededSetup = Extract<SetupState, { needed: true }>

// The server's refusals that the person can act on; anything else gets the step's own message.
export const refusal = (failure: unknown, fallback: string) => {
  if (failure instanceof RequestError && failure.code === 'invalid_code') return textNow('setup.codeWrong')
  if (failure instanceof RequestError && failure.code === 'too_many_attempts')
    return textNow('common.tooManyAttempts', { minutes: Math.ceil((failure.retryAfterSeconds ?? 900) / 60) })
  return fallback
}

// The setup's place: its step, the code, and what the current step says.
export const useFlow = (draft: SetupDraft | null) => {
  const [step, setStep] = useState<Step>(0)
  const [code, setCode] = useState(draft?.code ?? '')
  const [codeWrong, setCodeWrong] = useState(false)
  // Where the setup goes on once the code is typed again, after a restart of the server.
  const [resumeStep, setResumeStep] = useState<Step | null>(null)
  // The server's account just made: « Protège le compte » before going on (to this step).
  const [securing, setSecuring] = useState<Step | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const go = (next: Step) => {
    setError(null)
    setStep(next)
    window.scrollTo({ top: 0 })
  }
  return {
    ...{ step, setStep, code, setCode, codeWrong, setCodeWrong, resumeStep, setResumeStep, securing, setSecuring },
    ...{ notice, setNotice, busy, setBusy, error, setError, go }
  }
}

export type Flow = ReturnType<typeof useFlow>

// A first install guesses the country from the device's time zone, once its table has loaded, unless a country was
// already picked by then.
const useCountryGuess = (guess: boolean, setCountry: Dispatch<SetStateAction<string | null>>) => {
  useEffect(() => {
    if (!guess) return
    const spoken = deviceCountry()
    void timeZoneCountry(deviceTimeZone())
      .then(found => setCountry(current => (current === spoken ? found : current)))
      .catch(() => {})
  }, [guess, setCountry])
}

// The answers, kept on this device until the last step, all but the password and the AI key.
export const useAnswers = (draft: SetupDraft | null) => {
  const [email, setEmail] = useState(draft?.email ?? '')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [name, setName] = useState(draft?.name ?? '')
  const [profile, setProfile] = useState<ProfileDraft | null>(() =>
    draft?.profile ? { ...draft.profile, photo: draft.profile.photo ? blobOf(draft.profile.photo) : null } : null
  )
  const [photoUrl, setPhotoUrl] = useState<string | null>(draft?.profile?.photo ?? null)
  const [ai, setAi] = useState<string>(draft?.ai ?? NO_AI)
  const [key, setKey] = useState('')
  const [keyCheck, setKeyCheck] = useState<KeyCheck | null>(null)
  const [timeZone, setTimeZone] = useState(draft?.timeZone ?? deviceTimeZone)
  const [country, setCountry] = useState<string | null>(draft ? draft.country : deviceCountry)
  useCountryGuess(draft === null, setCountry)
  const strongEnough = passwordStrength(password).score > 0
  const accountReady = EMAIL_PATTERN.test(email.trim()) && strongEnough && password === confirm
  return {
    ...{ email, setEmail, password, setPassword, confirm, setConfirm, name, setName, profile, setProfile },
    ...{ photoUrl, setPhotoUrl, ai, setAi, key, setKey, keyCheck, setKeyCheck, timeZone, setTimeZone },
    ...{ country, setCountry, accountReady }
  }
}

export type Answers = ReturnType<typeof useAnswers>
