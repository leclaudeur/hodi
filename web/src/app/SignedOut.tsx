import { markSignedIn } from '../lib/after-sign-in.ts'
import LoginPage from '../pages/LoginPage.tsx'

// A device on no household: Connexion, drawn at once (no plugin stands in front of it). Once signed in, the app
// opens on its first page, not on #/sign-in nor on a code's link.
const SignedOut = ({ onLoggedIn }: { onLoggedIn: () => void }) => {
  const signedIn = () => {
    window.history.replaceState(null, '', '/')
    markSignedIn()
    onLoggedIn()
  }
  return <LoginPage onLoggedIn={signedIn} />
}

export default SignedOut
