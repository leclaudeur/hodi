import type { ReactNode } from 'react'
import { type AiProviderInfo, checkSetupKey } from '../../api.ts'
import { dataUrlOf } from '../../lib/profiles.ts'
import StatusLine from '../../ui/StatusLine.tsx'
import type { useTwoFactorSetup } from '../../views/account/TwoFactorSetup.tsx'
import SetupPluginStep from '../SetupPluginStep.tsx'
import AccountStep from './AccountStep.tsx'
import AiStep from './AiStep.tsx'
import CodeStep from './CodeStep.tsx'
import DoneStep from './DoneStep.tsx'
import HouseholdStep from './HouseholdStep.tsx'
import PluginsFoundStep from './PluginsFoundStep.tsx'
import ProfileStep from './ProfileStep.tsx'
import ReadyStep from './ReadyStep.tsx'
import SecureStep from './SecureStep.tsx'
import type { codeActions } from './setup-actions.ts'
import {
  type Answers,
  type Flow,
  HOUSEHOLD_STEP,
  type NeededSetup,
  PLUGINS_STEP,
  PLUGIN_STEPS,
  READY_STEP,
  STEPS
} from './setup-flow.ts'
import type { SetupPlugins } from './use-setup.ts'

// What each step draws from. Plain functions below rather than components: the page's tree stays what one
// component drew.
export interface Setup {
  setup: NeededSetup
  flow: Flow
  answers: Answers
  plugins: SetupPlugins
  code: ReturnType<typeof codeActions>
  twoFactor: ReturnType<typeof useTwoFactorSetup>
  provider: AiProviderInfo | null
  codeOrNull: string | null
  createAccount: () => Promise<void>
  savePlugins: () => Promise<void>
  later: () => Promise<void>
  finish: () => Promise<void>
}

// The welcome, with the setup code when it is asked.
const codeContent = (s: Setup) => {
  const { flow } = s
  return (
    <CodeStep
      codeRequired={s.code.codeRequired}
      code={flow.code}
      codeWrong={flow.codeWrong}
      busy={flow.busy}
      notice={flow.notice}
      error={flow.error}
      onCode={typed => {
        flow.setCode(typed)
        flow.setCodeWrong(false)
      }}
      onComplete={typed => void s.code.checkCode(typed)}
      onSubmit={s.code.start}
    />
  )
}

// Up to the account and the plugins' steps; null past them.
const accountContent = (s: Setup): ReactNode | null => {
  const { flow, answers, plugins } = s
  const total = STEPS + plugins.pluginSteps.length
  if (flow.securing !== null) {
    const next = flow.securing
    return (
      <SecureStep
        twoFactor={s.twoFactor}
        onContinue={() => {
          flow.setSecuring(null)
          flow.go(next)
        }}
      />
    )
  }
  if (flow.step === 0) return codeContent(s)
  if (flow.step === 1) {
    return (
      <AccountStep
        total={total}
        email={answers.email}
        password={answers.password}
        confirm={answers.confirm}
        onEmail={answers.setEmail}
        onPassword={answers.setPassword}
        onConfirm={answers.setConfirm}
        ready={answers.accountReady}
        busy={flow.busy}
        error={flow.error}
        onCreate={() => void s.createAccount()}
        onBack={() => void s.code.backToCode()}
      />
    )
  }
  if (flow.step === PLUGINS_STEP) {
    return (
      <PluginsFoundStep
        plugins={plugins.plugins}
        on={plugins.pluginsOn}
        busy={flow.busy}
        error={flow.error}
        onChange={plugins.setChecked}
        onContinue={() => void s.savePlugins()}
      />
    )
  }
  if (flow.step === PLUGIN_STEPS) {
    const current = plugins.pluginSteps[plugins.pluginIndex]
    return (
      current && (
        <SetupPluginStep
          plugin={current.plugin}
          step={current.step}
          index={2 + plugins.pluginIndex}
          total={total}
          onBack={plugins.previousPluginStep}
          onNext={plugins.nextPluginStep}
        />
      )
    )
  }
  return null
}

// The household's name and its admin profile.
const householdContent = (s: Setup): ReactNode => {
  const { flow, answers } = s
  const extra = s.plugins.pluginSteps.length
  const total = STEPS + extra
  if (flow.step === READY_STEP) {
    return (
      <ReadyStep
        email={answers.email}
        busy={flow.busy}
        error={flow.error}
        onLater={() => void s.later()}
        onHousehold={() => flow.go(HOUSEHOLD_STEP)}
      />
    )
  }
  if (flow.step === 2) {
    return (
      <HouseholdStep
        step={2 + extra}
        total={total}
        name={answers.name}
        onName={answers.setName}
        onNext={() => flow.go(3)}
        onBack={() => flow.go(READY_STEP)}
      />
    )
  }
  return (
    <ProfileStep
      step={3 + extra}
      total={total}
      profile={answers.profile}
      onBack={() => flow.go(2)}
      onSave={async next => {
        // A photo left unchanged keeps the one already chosen.
        const photo = next.photo === undefined ? (answers.profile?.photo ?? null) : next.photo
        answers.setProfile({ ...next, photo })
        answers.setPhotoUrl(photo ? await dataUrlOf(photo).catch(() => null) : null)
        flow.go(4)
      }}
    />
  )
}

// The AI, then the recap and its button.
const lastContent = (s: Setup): ReactNode => {
  const { flow, answers, provider } = s
  const extra = s.plugins.pluginSteps.length
  const total = STEPS + extra
  if (flow.step === 4) {
    return (
      <AiStep
        step={4 + extra}
        total={total}
        providers={s.setup.providers}
        ai={answers.ai}
        onAi={answers.setAi}
        provider={provider}
        aiKey={answers.key}
        onAiKey={answers.setKey}
        keyCheck={answers.keyCheck}
        onKeyCheck={answers.setKeyCheck}
        checkKey={(id, typed) => checkSetupKey(s.codeOrNull, id, typed)}
        country={answers.country}
        onCountry={answers.setCountry}
        onNext={() => flow.go(5)}
        onBack={() => flow.go(3)}
      />
    )
  }
  return (
    <DoneStep
      step={5 + extra}
      total={total}
      timeZone={answers.timeZone}
      onTimeZone={answers.setTimeZone}
      email={answers.email}
      household={answers.name.trim()}
      profile={answers.profile?.name ?? ''}
      provider={provider}
      busy={flow.busy}
      error={flow.error}
      onFinish={() => void s.finish()}
      onBack={() => flow.go(4)}
    />
  )
}

export const setupContent = (s: Setup | null, error: string | null): ReactNode => {
  if (!s) return error && <StatusLine tone="error">{error}</StatusLine>
  const early = accountContent(s)
  if (early !== null) return early
  const { step } = s.flow
  if (step === READY_STEP || step === 2 || step === 3) return householdContent(s)
  return lastContent(s)
}
