import { useSyncExternalStore } from 'react'
import { markSignedIn } from '../lib/after-sign-in.ts'
import { RESET_LINK } from '../pages/ForgotPage.tsx'
import { CODE_LINK } from '../pages/JoinPage.tsx'
import LoginPage from '../pages/LoginPage.tsx'
import PluginSlot from '../plugins/PluginSlot.tsx'
import { usePluginSlots, usePlugins } from '../plugins/registry.ts'
import { useScreenLayout } from '../plugins/Slots.tsx'

// Connexion's own address, once a plugin's page stands in front of it.
const SIGN_IN = '#/sign-in'

const useHash = () =>
  useSyncExternalStore(
    listener => {
      window.addEventListener('hashchange', listener)
      return () => window.removeEventListener('hashchange', listener)
    },
    () => window.location.hash
  )

// A device on no household: Connexion, or the page a plugin shows in its place (the first plugin that has one). A
// code's link, a reset link and #/sign-in always open Hodi's own pages.
const SignedOut = ({ onLoggedIn }: { onLoggedIn: () => void }) => {
  const hash = useHash()
  const { ready } = usePlugins()
  const [page] = usePluginSlots('signedOutPage')
  const layout = useScreenLayout()
  const signedIn = () => {
    // The app opens on its first page, not on #/sign-in nor on a plugin's own address.
    window.history.replaceState(null, '', '/')
    markSignedIn()
    onLoggedIn()
  }
  const direct = hash === SIGN_IN || CODE_LINK.test(hash) || RESET_LINK.test(hash)

  // The page's background until the plugins are known, so that Connexion never flashes before a plugin's page.
  if (!direct && !ready) return null

  if (!direct && page)
    return (
      <PluginSlot
        id={page.id}
        component={page.value}
        props={{
          layout,
          signedIn,
          showSignIn: () => {
            window.location.hash = SIGN_IN
          }
        }}
        // A page that breaks leaves Connexion, never a blank screen.
        fallback={<LoginPage onLoggedIn={signedIn} />}
      />
    )

  return <LoginPage onLoggedIn={signedIn} />
}

export default SignedOut
