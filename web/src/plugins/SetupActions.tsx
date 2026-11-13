import { createContext, type ReactNode, use } from 'react'
import { Actions } from '../pages/SetupParts.tsx'

// « Retour » of the setup step a plugin's page is drawn in: Hodi gives it, the plugin never knows where it leads.
export const SetupBackContext = createContext<(() => void) | null>(null)

// The buttons at the foot of a plugin's setup step, as Hodi's own steps have them: « Retour » on the left, the
// plugin's own buttons on the right (its primary one last), and maybe one more on the left, such as « Plus tard ».
const SetupActions = ({ start, children }: { start?: ReactNode; children: ReactNode }) => {
  const back = use(SetupBackContext)
  return (
    <Actions onBack={back ?? undefined} start={start}>
      {children}
    </Actions>
  )
}

export default SetupActions
