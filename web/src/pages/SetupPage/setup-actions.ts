import type { Dispatch, FormEvent, SetStateAction } from 'react'
import {
  type AiProviderInfo,
  RequestError,
  SETUP_CODE_LENGTH,
  checkSetupCode,
  getSetup,
  setUpAccount,
  setUpHousehold,
  setUpHouseholdLater,
  setUpPlugins,
  uploadProfilePhoto
} from '../../api.ts'
import { type Language, t as textNow } from '../../lib/i18n.ts'
import { clearSetupDraft, loadSetupDraft, saveSetupDraft } from '../../lib/setup-draft.ts'
import {
  type Answers,
  type Flow,
  type NeededSetup,
  PLUGINS_STEP,
  PLUGIN_STEPS,
  READY_STEP,
  type Step,
  refusal
} from './setup-flow.ts'

// A kept code refused: the server restarted since it was typed. The field empties, and the setup comes back to
// `from` once the new code is in.
export const recheckOf = (flow: Flow) => async (kept: string, from: Step | null) => {
  try {
    await checkSetupCode(kept)
    return true
  } catch (failure) {
    if (failure instanceof RequestError && failure.code === 'invalid_code') {
      flow.setCode('')
      flow.setResumeStep(from)
      flow.setStep(0)
      flow.setNotice(textNow('setup.restarted'))
      return false
    }
    if (failure instanceof RequestError && failure.code === 'too_many_attempts') {
      flow.setStep(0)
      flow.setError(refusal(failure, ''))
      return false
    }
    // Not reachable right now: "Continuer" checks the code again anyway.
    return true
  }
}

// The setup code: checked as typed, and again on the way back to it.
export const codeActions = (flow: Flow, setup: NeededSetup | null) => {
  const codeRequired = setup?.stage === 'account' && setup.codeRequired
  const recheckCode = recheckOf(flow)

  // Back on the code: checked first, so a code that is no longer valid never shows.
  const backToCode = async () => {
    if (setup?.stage === 'account' && setup.codeRequired && flow.code.length === SETUP_CODE_LENGTH) {
      flow.setBusy(true)
      const valid = await recheckCode(flow.code, 1)
      flow.setBusy(false)
      if (!valid) return
    }
    flow.go(0)
  }

  // As a profile's PIN: checked as soon as its 6 digits are typed, or with "Commencer".
  const checkCode = async (typed: string) => {
    flow.setBusy(true)
    flow.setError(null)
    flow.setCodeWrong(false)
    try {
      await checkSetupCode(typed)
      flow.setNotice(null)
      flow.go(flow.resumeStep ?? 1)
      flow.setResumeStep(null)
    } catch (failure) {
      flow.setCodeWrong(failure instanceof RequestError && failure.code === 'invalid_code')
      flow.setError(refusal(failure, textNow('setup.codeCheckFailed')))
    } finally {
      flow.setBusy(false)
    }
  }

  const start = (event: FormEvent) => {
    event.preventDefault()
    if (codeRequired) void checkCode(flow.code)
    else flow.go(1)
  }

  return { codeRequired, backToCode, checkCode, start }
}

// Set up from another device (409) or this one's session ended (401): the app checks again.
const handedBack = (failure: unknown) =>
  failure instanceof RequestError && (failure.status === 409 || failure.status === 401)

interface Wiring {
  flow: Flow
  answers: Answers
  setup: NeededSetup | null
  setSetup: Dispatch<SetStateAction<NeededSetup | null>>
  codeOrNull: string | null
  onDone: () => void
}

// "Compte": made at once, so the rest of the setup goes on signed in, here or on another device.
export const accountActions =
  ({ flow, answers, setSetup, codeOrNull }: Wiring) =>
  async () => {
    flow.setBusy(true)
    flow.setError(null)
    try {
      await setUpAccount({ code: codeOrNull, email: answers.email.trim(), password: answers.password })
      answers.setPassword('')
      answers.setConfirm('')
      // Signed in now: the setup's state lists the plugins found, for the server's admin only.
      const state = await getSetup().catch(() => null)
      const signedIn = state?.needed && state.stage === 'household' ? state : null
      setSetup(
        current =>
          signedIn ?? (current && { needed: true, stage: 'household', signedIn: true, providers: current.providers })
      )
      flow.setSecuring((signedIn?.plugins?.length ?? 0) > 0 ? PLUGINS_STEP : READY_STEP)
    } catch (failure) {
      if (failure instanceof RequestError && failure.status === 409) {
        // Another device made the server's account first: this one signs in with it.
        window.location.reload()
        return
      }
      if (failure instanceof RequestError && failure.code === 'invalid_code') {
        flow.setCode('')
        flow.setResumeStep(1)
        flow.setStep(0)
        flow.setNotice(textNow('setup.restarted'))
        return
      }
      flow.setError(refusal(failure, textNow('setup.setupFailed')))
    } finally {
      flow.setBusy(false)
    }
  }

// « Plugins trouvés »: the unchecked ones are turned off, and stay in data/plugins for Serveur › Plugins.
export const pluginsAction =
  (
    { flow, answers, setSetup, onDone }: Wiring,
    on: Set<string>,
    loaded: boolean,
    setPluginStep: (step: null) => void
  ) =>
  async () => {
    flow.setBusy(true)
    flow.setError(null)
    try {
      const { plugins: saved } = await setUpPlugins([...on])
      setSetup(current => (current && current.stage === 'household' ? { ...current, plugins: saved } : current))
      setPluginStep(null)
      // Their web parts were loaded before this choice changed: a reload loads those now on.
      if (loaded) {
        const { code } = flow
        const { email, name, ai, timeZone, country } = answers
        saveSetupDraft({
          ...(loadSetupDraft() ?? { code, email, name, profile: null, ai, timeZone, country }),
          step: PLUGIN_STEPS
        })
        window.location.reload()
        return
      }
      flow.go(PLUGIN_STEPS)
    } catch (failure) {
      if (handedBack(failure)) {
        onDone()
        return
      }
      flow.setError(textNow('setup.plugins.failed'))
    } finally {
      flow.setBusy(false)
    }
  }

// « Aller à l'espace Serveur »: no household for now, the server's admin goes to /server, where Serveur › Foyers
// makes one, for them or for someone else.
export const laterAction =
  ({ flow, onDone }: Wiring) =>
  async () => {
    flow.setBusy(true)
    flow.setError(null)
    try {
      await setUpHouseholdLater()
      clearSetupDraft()
      window.location.hash = '#/server'
      onDone()
    } catch (failure) {
      if (handedBack(failure)) {
        onDone()
        return
      }
      flow.setError(textNow('setup.household.laterFailed'))
      flow.setBusy(false)
    }
  }

// The household, its admin profile, the AI and the region reach the server together.
export const finishAction =
  ({ flow, answers, onDone }: Wiring, provider: AiProviderInfo | null, language: Language) =>
  async () => {
    const { profile } = answers
    if (!profile) return
    flow.setBusy(true)
    flow.setError(null)
    try {
      const { profileId } = await setUpHousehold({
        name: answers.name.replace(/\s+/g, ' ').trim(),
        profile: { name: profile.name, color: profile.color },
        timeZone: answers.timeZone,
        country: provider ? answers.country : null,
        language,
        ai: provider ? { provider: provider.id, key: answers.key.trim() } : null
      })
      // The photo once the profile is open; the household is set up whatever happens to it.
      if (profile.photo && profileId !== null) await uploadProfilePhoto(profileId, profile.photo).catch(() => {})
      clearSetupDraft()
      onDone()
    } catch (failure) {
      if (handedBack(failure)) {
        // Set up from another device, or this one's session ended: the app checks again and signs in if need be.
        if (failure instanceof RequestError && failure.status === 409) clearSetupDraft()
        onDone()
        return
      }
      flow.setError(refusal(failure, textNow('setup.setupFailed')))
      flow.setBusy(false)
    }
  }
