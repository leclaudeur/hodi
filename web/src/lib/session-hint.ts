// Whether this browser had a session the last time the app asked. public/preload.js reads it (same key) to ask for the
// signed-in app's first requests only then: a visitor who never signed in would get each of them refused.
const KEY = 'hodi:had-session'

export const rememberSession = (present: boolean) => {
  try {
    if (present) localStorage.setItem(KEY, '1')
    else localStorage.removeItem(KEY)
  } catch {
    // Storage blocked: preload.js then asks only for the session, and the app for the rest once it knows.
  }
}

// Whether this tab had a profile open the last time the app knew. preload.js reads it (same key) to ask for the
// profile's own data only then: a new tab starts on « Qui lit ? », and a profile that asks for its password answers
// each of those requests with a refusal, which a proxy such as CrowdSec counts as probing.
const PROFILE_KEY = 'hodi:profile-open'

export const rememberProfileOpen = (open: boolean) => {
  try {
    if (open) sessionStorage.setItem(PROFILE_KEY, '1')
    else sessionStorage.removeItem(PROFILE_KEY)
  } catch {
    // Storage blocked: preload.js then asks for nothing of the profile's, and the app asks itself.
  }
}
