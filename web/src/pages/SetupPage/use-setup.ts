import { useEffect, useMemo, useState } from 'react'
import { SETUP_CODE_LENGTH, getSetup } from '../../api.ts'
import { t as textNow } from '../../lib/i18n.ts'
import { type SetupDraft, clearSetupDraft, saveSetupDraft } from '../../lib/setup-draft.ts'
import { setupPluginSteps } from '../../plugins/menu.ts'
import { loadPlugins, usePlugins } from '../../plugins/registry.ts'
import { NO_AI } from './AiStep.tsx'
import {
  type Answers,
  type Flow,
  HOUSEHOLD_LINK,
  HOUSEHOLD_STEP,
  type NeededSetup,
  PLUGINS_STEP,
  PLUGIN_STEPS,
  READY_STEP,
  type Step
} from './setup-flow.ts'

// Past the account, the setup resumes where it was left; the AI key, never kept, is asked again.
const resumedStep = (state: Extract<NeededSetup, { stage: 'household' }>, draft: SetupDraft | null): Step => {
  const fromServer = window.location.hash === HOUSEHOLD_LINK
  if (fromServer) window.history.replaceState(null, '', '/')
  const kept = draft?.step ?? (fromServer ? HOUSEHOLD_STEP : READY_STEP)
  const resumed = kept === 5 && draft?.ai !== NO_AI ? 4 : kept
  // Plugins removed since: nothing left to check.
  const found = resumed !== PLUGINS_STEP || (state.plugins?.length ?? 0) > 0
  return found ? (Math.max(HOUSEHOLD_STEP, resumed) as Step) : READY_STEP
}

// What the server says as the page opens: set up from another device, or where this setup resumes.
export const useSetupLoad = (
  draft: SetupDraft | null,
  onDone: () => void,
  flow: Flow,
  answers: Answers,
  recheckCode: (kept: string, from: Step | null) => Promise<boolean>
) => {
  const [setup, setSetup] = useState<NeededSetup | null>(null)
  useEffect(() => {
    getSetup()
      .then(async state => {
        if (!state.needed) {
          // Set up from another device: this one's unfinished answers are of no use any more.
          clearSetupDraft()
          onDone()
          return
        }
        if (state.stage === 'household') {
          if (state.email) answers.setEmail(state.email)
          flow.setStep(resumedStep(state, draft))
        } else if (draft && draft.step >= 1) {
          // The code changes with each start of the server: a resumed setup checks the kept one before showing its
          // step, so a restart leads straight back to an empty code instead of failing on "Continuer".
          const valid =
            !state.codeRequired || (draft.code.length === SETUP_CODE_LENGTH && (await recheckCode(draft.code, 1)))
          if (valid) flow.setStep(1)
          else if (draft.code.length !== SETUP_CODE_LENGTH) flow.setResumeStep(1)
        }
        setSetup(state)
      })
      .catch(() => flow.setError(textNow('common.unreachable')))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, as the page opens: the setters are stable
  }, [draft, onDone])
  return [setup, setSetup] as const
}

// Every answer is kept on this device as it changes.
export const useDraftSaving = (flow: Flow, answers: Answers, pluginStep: SetupDraft['pluginStep'] | null) => {
  const { step, code } = flow
  const { email, name, profile, photoUrl, ai, timeZone, country } = answers
  useEffect(() => {
    saveSetupDraft({
      step,
      ...(step === PLUGIN_STEPS && pluginStep ? { pluginStep } : {}),
      code,
      email,
      name,
      profile: profile && { name: profile.name, color: profile.color, photo: photoUrl },
      ai,
      timeZone,
      country
    })
  }, [step, pluginStep, code, email, name, profile, photoUrl, ai, timeZone, country])
}

// The plugins found in data/plugins, those checked at « Plugins trouvés », and the steps of those turned on.
export const useSetupPlugins = (setup: NeededSetup | null, flow: Flow, draft: SetupDraft | null) => {
  const registry = usePlugins()
  // The plugins checked at « Plugins trouvés »; null until one is changed: those that are on.
  const [checked, setChecked] = useState<Set<string> | null>(null)
  // Which of the plugins' steps is shown, by its plugin and its id; null: the first.
  const [pluginStep, setPluginStep] = useState<{ plugin: string; id: string } | null>(draft?.pluginStep ?? null)
  const plugins = useMemo(() => (setup?.stage === 'household' ? (setup.plugins ?? []) : []), [setup])
  // A plugin nobody signed is offered off: the admin turns it on knowing that.
  const pluginsOn =
    checked ?? new Set(plugins.filter(plugin => plugin.enabled && plugin.signed).map(plugin => plugin.id))
  // The steps of the plugins turned on at « Plugins trouvés », once their web parts are loaded.
  const enabledIds = useMemo(
    () => new Set(plugins.filter(plugin => plugin.enabled && !plugin.error).map(plugin => plugin.id)),
    [plugins]
  )
  const pluginSteps = useMemo(
    () =>
      setupPluginSteps(
        registry.plugins.filter(plugin => enabledIds.has(plugin.id)),
        registry.web
      ),
    [registry.plugins, registry.web, enabledIds]
  )
  const pluginIndex = Math.max(
    0,
    pluginStep
      ? pluginSteps.findIndex(({ plugin, step: s }) => plugin.id === pluginStep.plugin && s.id === pluginStep.id)
      : 0
  )
  const { go } = flow
  const moveTo = (to: (typeof pluginSteps)[number] | undefined, otherwise: Step) => {
    if (!to) {
      go(otherwise)
      return
    }
    setPluginStep({ plugin: to.plugin.id, id: to.step.id })
    window.scrollTo({ top: 0 })
  }
  const nextPluginStep = () => moveTo(pluginSteps[pluginIndex + 1], READY_STEP)
  const previousPluginStep = () => moveTo(pluginSteps[pluginIndex - 1], plugins.length > 0 ? PLUGINS_STEP : READY_STEP)

  return {
    ...{ registry, plugins, pluginsOn, setChecked, pluginStep, setPluginStep, pluginSteps, pluginIndex },
    ...{ nextPluginStep, previousPluginStep }
  }
}

export type SetupPlugins = ReturnType<typeof useSetupPlugins>

// The plugins' steps as they come: their web parts loaded, or on to « Le serveur est prêt » when none is left.
export const usePluginStepsLoading = (setup: NeededSetup | null, flow: Flow, plugins: SetupPlugins) => {
  const { step, go } = flow
  const { registry, pluginSteps, pluginIndex } = plugins
  // The plugins' web parts load when their steps come, also after a reload in the middle of them.
  useEffect(() => {
    if (step === PLUGIN_STEPS) void loadPlugins()
  }, [step])

  // No step to show (no plugin with steps, or the one kept is gone): on to « Le serveur est prêt ».
  useEffect(() => {
    if (step === PLUGIN_STEPS && setup && registry.ready && !pluginSteps[pluginIndex]) go(READY_STEP)
  })
}
