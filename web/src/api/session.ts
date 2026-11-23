import { type Language as InterfaceLanguage, isLanguage } from '../lib/i18n.ts'
import { type SignInRefusal, refusalOf } from '../lib/sign-in-refusal.ts'
import { rememberSession } from '../lib/session-hint.ts'
import { rememberSignedIn } from '../lib/public-home.ts'
import { clearUserState } from '../lib/user-state.ts'
import { sendJson } from './http.ts'
import type { AdminProof } from './plugins.ts'

export type LoginResult =
  | { ok: true }
  | { ok: false; reason: 'invalid_password' | 'error' | 'two_factor' | 'invalid_code' | 'blocked' }
  | { ok: false; reason: 'too_many_attempts'; retryAfterSeconds: number }
  | { ok: false; reason: 'refused'; refusal: SignInRefusal }
  // An account of another household than the one this device serves: both their names.
  | { ok: false; reason: 'other_household'; household: string | null; here: string | null }

export interface Session {
  // False: the household's profiles are not picked on this device yet ("Qui lit ?").
  profileChosen: boolean
  // The household's: the interface's for every profile that did not pick its own.
  language: InterfaceLanguage | null
  // How the household writes the time of day.
  hourCycle: 12 | 24
  // How long an article stays in the lists and a video in Vidéos, in days (Serveur › Contenu).
  content: { articleDays: number; videoDays: number; backupCopies: number } | null
  // No household yet (« Plus tard » at the setup): the server's admin, in /server only.
  serverOnly: boolean
  // An account whose profile was deleted from its household: its own account alone.
  noHousehold: boolean
  // « Validation en deux étapes » of the account reading here.
  twoFactor: boolean
  // The account reading here has no password of its own (« Se connecter avec Google »).
  noPassword: boolean
}

// The session; null when logged out; 'setup' while the install waits for its first-run screens.
// The app opening again: this device reads as nobody until « Qui lit ? » answers.
export const leaveProfile = () => fetch('/api/profiles/current', { method: 'DELETE' }).then(() => undefined)

// fresh: not the answer preload.js asked for as the page loaded, which may predate the profile closing on opening.
export const getSession = async (fresh = false): Promise<Session | null | 'setup'> => {
  // Another address than preload.js's, so the browser does not hand back its answer.
  const response = await fetch(fresh ? '/api/session?fresh' : '/api/session')

  if (response.status === 401) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    return body?.error === 'setup_required' ? 'setup' : null
  }

  if (!response.ok) {
    throw new Error(`Session check failed with status ${response.status}`)
  }

  const body = (await response.json()) as Partial<Session>
  rememberSignedIn()
  return {
    profileChosen: body.profileChosen === true,
    language: isLanguage(body.language) ? body.language : null,
    hourCycle: body.hourCycle === 12 ? 12 : 24,
    content: body.content ?? null,
    serverOnly: body.serverOnly === true,
    noHousehold: body.noHousehold === true,
    twoFactor: body.twoFactor === true,
    noPassword: body.noPassword === true
  }
}

// A personal account's e-mail and password.
// code: with « Validation en deux étapes », the app's 6 digits or a recovery code, once the server asked for it.
export const login = async (email: string, password: string, code?: string): Promise<LoginResult> => {
  const response = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(code === undefined ? { email, password } : { email, password, code })
  })

  if (response.ok) {
    return { ok: true }
  }

  // 400: what was typed is neither an e-mail nor an identifier, as wrong as a wrong password.
  if (response.status === 401 || response.status === 400) {
    return { ok: false, reason: 'invalid_password' }
  }

  if (response.status === 429) {
    const body = (await response.json()) as { retryAfterSeconds?: number }
    return { ok: false, reason: 'too_many_attempts', retryAfterSeconds: body.retryAfterSeconds ?? 900 }
  }

  if (response.status === 409) {
    const body = (await response.json().catch(() => null)) as { household?: string; here?: string } | null
    return { ok: false, reason: 'other_household', household: body?.household ?? null, here: body?.here ?? null }
  }

  if (response.status === 403) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    // The password is right: the app's code comes next, or the one typed was wrong.
    if (body?.error === 'two_factor_required') return { ok: false, reason: 'two_factor' }
    if (body?.error === 'invalid_code') return { ok: false, reason: 'invalid_code' }
    // Its account was blocked by the server's admin.
    if (body?.error === 'blocked') return { ok: false, reason: 'blocked' }
    const refusal = refusalOf(body)
    if (refusal) return { ok: false, reason: 'refused', refusal }
  }

  return { ok: false, reason: 'error' }
}

// The app's code after a plugin signed in an account with « Validation en deux étapes » on: the ticket its answer
// carried (Hodi-Second-Step) stands for the password.
export const secondStep = (ticket: string, code: string) =>
  sendJson<null>('POST', '/login/second-step', { ticket, code })

// « Validation en deux étapes »: a secret for the authenticator app, as its QR's otpauth link and as text to type.
// The password, unless the device signed in a moment ago (the setup's « Protège le compte »).
export const startTwoFactor = (password?: string) =>
  sendJson<{ secret: string; uri: string }>('POST', '/account/two-factor', password === undefined ? {} : { password })
// The app's first code proves it holds the secret: it is on from then, with 10 recovery codes shown once.
export const confirmTwoFactor = (code: string) =>
  sendJson<{ recoveryCodes: string[] }>('PUT', '/account/two-factor', { code })
export const stopTwoFactor = (proof: AdminProof) => sendJson<null>('DELETE', '/account/two-factor', proof)
export const newRecoveryCodes = (proof: AdminProof) =>
  sendJson<{ recoveryCodes: string[] }>('POST', '/account/two-factor/recovery-codes', proof)

// Offline copies of the API kept by the service worker (same name in public/sw.js).
export const DATA_CACHE = 'hodi-data-v1'

export const logout = async () => {
  await fetch('/api/logout', { method: 'POST' })
  clearUserState()
  rememberSession(false)

  // Nothing read here stays on the device after logging out.
  await clearDataCache()
}

// The offline copies, which belong to the profile that read them.
export const clearDataCache = async () => {
  if ('caches' in window) await caches.delete(DATA_CACHE)
}
