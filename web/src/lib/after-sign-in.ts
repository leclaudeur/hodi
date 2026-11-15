// Signed in from Connexion (or a plugin's page): the app starts again, and a plugin's step may come first
// (afterSignIn). The mark lives in this tab only, until that step is done; a reload in the middle comes back to it.
const KEY = 'hodi:after-sign-in'

export const markSignedIn = () => {
  try {
    sessionStorage.setItem(KEY, '1')
  } catch {
    // Without storage, no step after sign-in: the app opens as it would.
  }
}

export const isJustSignedIn = () => {
  try {
    return sessionStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export const clearSignedIn = () => {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // Nothing kept, nothing to clear.
  }
}
