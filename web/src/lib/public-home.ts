// Serveur › Général's public site: a browser that never had a session here, opening the app's bare address, goes
// there. Once it signed in, it stays on Connexion for good, even signed out; any other address (#/sign-in, a code's or
// a reset's link) opens Hodi's own page, and so does the app added to a home screen, which has its own storage.
const KEY = 'hodi:signed-in-before'

export const rememberSignedIn = () => {
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    // Storage blocked: the browser is taken for a new one, and the site's « Se connecter » still opens Connexion.
  }
}

const signedInBefore = () => {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

// Opened from a home screen or a desktop shortcut: someone who installed the app came to use it, not to read the site.
const installed = () =>
  window.matchMedia('(display-mode: standalone), (display-mode: window-controls-overlay)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true

export const publicHomeFor = (
  home: string | null | undefined,
  hash: string,
  before = signedInBefore(),
  app = installed()
) => (home && !before && !app && (hash === '' || hash === '#' || hash === '#/') ? home : null)
