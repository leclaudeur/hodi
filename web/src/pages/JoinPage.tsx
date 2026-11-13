import { SetupFrame } from './SetupParts.tsx'
import { AccountStep, CodeStep, DeviceStep, FullStep, ResetStep, WhoStep } from './JoinSteps.tsx'
import { useJoin } from './use-join.ts'

interface JoinPageProps {
  // From a link (#/code/<digits>): the code typed already, checked at once.
  initialCode?: string
  // Back to the Connexion page.
  onBack: () => void
  // The account is made and this device signed in with it, on its profile.
  // signedIn false: the account asks for its app's code, so the device signs in on Connexion.
  onDone: (signedIn: boolean) => void
}

// The link a code comes with: the Connexion page opens on "Entre le code", filled in.
export const CODE_LINK = /^#\/code\/([A-HJKMNP-Z2-9]{8})$/

// "J'ai un code": the code an adult of the household gave, then the person's own account. An invitation adds them
// as a new adult ("Rejoins <foyer>", then "Et toi, c'est qui ?"); a code for a profile hands them that profile
// ("Dernière étape : le profil"). A young profile's code makes no account: "Relier cet appareil" links the device to it.
// The admin's code for an adult who forgot their password opens "Nouveau mot de passe".
const JoinPage = ({ initialCode = '', onBack, onDone }: JoinPageProps) => {
  const join = useJoin(initialCode, onDone)
  const { step, use } = join
  let content
  if (step === 'code' || !use) content = <CodeStep join={join} onBack={onBack} />
  else if (use.kind === 'invite' && use.full) content = <FullStep onBack={onBack} />
  else if (use.kind === 'device') content = <DeviceStep join={join} use={use} />
  else if (use.kind === 'reset') content = <ResetStep join={join} use={use} />
  else if (step === 'account') content = <AccountStep join={join} use={use} />
  else content = <WhoStep join={join} />
  return <SetupFrame>{content}</SetupFrame>
}

export default JoinPage
