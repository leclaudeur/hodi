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
