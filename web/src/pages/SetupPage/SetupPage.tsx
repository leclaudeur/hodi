import { useState } from 'react'
import { useLanguage } from '../../lib/i18n.ts'
import { loadSetupDraft } from '../../lib/setup-draft.ts'
import { useTwoFactorSetup } from '../../views/account/TwoFactorSetup.tsx'
import LoginPage from '../LoginPage.tsx'
import { SetupFrame } from '../SetupParts.tsx'
import { accountActions, codeActions, finishAction, laterAction, pluginsAction, recheckOf } from './setup-actions.ts'
import { setupContent } from './setup-content.tsx'
import { useAnswers, useFlow } from './setup-flow.ts'
import { useDraftSaving, usePluginStepsLoading, useSetupLoad, useSetupPlugins } from './use-setup.ts'

interface SetupPageProps {
  // Set up (here or on another device): the app checks the session again.
  onDone: () => void
}

// The first visit of a new install. "Compte" makes the server admin's account and signs this device in; the
// household, its admin profile, the AI if wanted and the region then reach the server with the last step's button.
// Until then the answers are kept on this device, so the setup resumes later, all but the password and the AI key.
// A device that is not signed in once the account exists signs in first.
const SetupPage = ({ onDone }: SetupPageProps) => {
  const language = useLanguage()
  const [draft] = useState(loadSetupDraft)
  const flow = useFlow(draft)
  const answers = useAnswers(draft)
  const [setup, setSetup] = useSetupLoad(draft, onDone, flow, answers, recheckOf(flow))
  const twoFactor = useTwoFactorSetup(flow.securing !== null)
  const plugins = useSetupPlugins(setup, flow, draft)
  useDraftSaving(flow, answers, plugins.pluginStep)
  usePluginStepsLoading(setup, flow, plugins)

  const code = codeActions(flow, setup)
  // Past the account, the session stands for the code.
  const codeOrNull = code.codeRequired ? flow.code : null
  const provider = setup?.providers.find(candidate => candidate.id === answers.ai) ?? null
  const wiring = { flow, answers, setup, setSetup, codeOrNull, onDone }

  // The account exists but this device is not signed in with it: it signs in, then the setup goes on.
  if (setup?.stage === 'household' && !setup.signedIn) return <LoginPage onLoggedIn={() => window.location.reload()} />

  const s = setup && {
    ...{ setup, flow, answers, plugins, code, twoFactor, provider, codeOrNull },
    createAccount: accountActions(wiring),
    savePlugins: pluginsAction(wiring, plugins.pluginsOn, plugins.registry.ready, plugins.setPluginStep),
    later: laterAction(wiring),
    finish: finishAction(wiring, provider, language)
  }
  return <SetupFrame>{setupContent(s, flow.error)}</SetupFrame>
}

export default SetupPage
