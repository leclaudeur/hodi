import { type Language as InterfaceLanguage } from '../lib/i18n.ts'
import type { PluginTranslations } from '../plugins/plugin-texts.ts'
import { RequestError, UnauthorizedError, getJson, sendJson } from './http.ts'
import type { AdminProof } from './plugins.ts'
import type { Profile, ProfileColor } from './profiles.ts'

// The household: first-run screens, accounts, codes, Réglages > Foyer and the AI's key. Mirrors server/http/household-routes.ts.

// Hodi's code, which the AGPL asks to offer to whoever uses it.
export const SOURCE_URL = 'https://github.com/leclaudeur/hodi'
// Where whoever likes Hodi can give to its work: Hodi has no ads and nothing to pay.
export const SUPPORT_URL = 'https://www.patreon.com/cw/LeClaudeur'

export const MIN_PASSWORD_LENGTH = 8
// The setup code printed in the server's log, asked away from the server.
export const SETUP_CODE_LENGTH = 8
export const MAX_HOUSEHOLD_NAME_LENGTH = 40

export interface AiProviderInfo {
  id: string
  name: string
  // Where its keys are made.
  keysUrl: string
}

// ok: the key works; invalid: refused; unreachable: no answer from the provider.
export type KeyCheck = 'ok' | 'invalid' | 'unreachable'

// account: nobody has an account yet, the setup starts with "Ton compte". household: the server admin has one, and
// signedIn says whether on this device.
export type SetupState =
  | { needed: true; stage: 'account'; codeRequired: boolean; providers: AiProviderInfo[] }
  | {
      needed: true
      stage: 'household'
      signedIn: boolean
      email?: string
      // « Plugins trouvés »: the ones put in data/plugins before the first start, for the signed-in server admin.
      plugins?: SetupPlugin[]
      providers: AiProviderInfo[]
    }
  // resetByMail: « Mot de passe oublié » can send its link (Serveur › E-mail is set). name: null while the setup
  // left the household for later.
  | { needed: false; name: string | null; language?: InterfaceLanguage; resetByMail?: boolean }

export interface SetupPlugin {
  id: string
  name: string
  description: string | null
  translations: PluginTranslations
  enabled: boolean
  // Unsigned: offered off, and its pages never show.
  signed: boolean
  // Not loaded: listed, off, and it cannot be turned on.
  error: string | null
}

export const getSetup = () => getJson<SetupState>('/setup')

// « Plugins trouvés »: the checked ones stay on, the others are turned off (and stay installed).
export const setUpPlugins = (enabled: string[]) =>
  sendJson<{ plugins: SetupPlugin[] }>('POST', '/setup/plugins', { enabled })

// The code from the server's log, when this device is away from the server.
export const checkSetupCode = (code: string) => sendJson<null>('POST', '/setup/code', { code })

export const checkSetupKey = async (code: string | null, provider: string, key: string) =>
  (await sendJson<{ result: KeyCheck }>('POST', '/setup/ai-check', { code, provider, key })).result

// "Ton compte": the server admin's account, which signs this device in.
export const setUpAccount = (account: { code: string | null; email: string; password: string }) =>
  sendJson<null>('POST', '/setup/account', account)

// « Plus tard » at the household step: the server goes on with no household, its admin in /server.
export const setUpHouseholdLater = () => sendJson<null>('POST', '/setup/later')

// Réglages > Compte et données: the account signed in on this device, its devices, and what deleting it takes.
export interface AccountDevice {
  id: number
  userAgent: string
  lastSeenAt: number
  current: boolean
}

export interface AccountView {
  email: string
  passwordChangedAt: number
  // No password of its own: a change needs a sign-in on this device in the last 5 minutes (recentSignIn).
  loginOnly: boolean
  recentSignIn: boolean
  devices: AccountDevice[]
  // householdGoes: no other adult has an account; others: the other profiles that go with it.
  deletion: { householdGoes: boolean; household: string; others: string[] } | null
  // « Validation en deux étapes »: on since then, or null. required: the server's admin cannot turn it off.
  twoFactor: { since: number | null; required: boolean; recoveryLeft: number }
}

// null: no account here (an install still on the household's password, or a young profile open on this device).
export const getAccount = async (): Promise<AccountView | null> => {
  const response = await fetch('/api/account')
  if (response.status === 401) throw new UnauthorizedError('Session expired')
  if (response.status === 403) return null
  if (!response.ok) throw new RequestError(response.status, null, null)
  return (await response.json()) as AccountView
}

export const changeAccountEmail = (email: string, password: string) =>
  sendJson<AccountView>('PUT', '/account/email', { email, password })

export const changeAccountPassword = (current: string, next: string) =>
  sendJson<AccountView>('PUT', '/account/password', { current, next })

export const signOutDevice = (id: number) => sendJson<AccountView>('DELETE', `/account/devices/${id}`)

// A JSON file, straight to the browser's downloads.
export const ACCOUNT_COPY_URL = '/api/account/copy'

export const deleteAccount = (proof?: AdminProof) => sendJson<null>('DELETE', '/account', proof)

// "J'ai un code": eight letters and digits an adult gives, valid once and for a day. None of 0, O, 1, I or L, which
// read alike (the server's sign-in-code-store.ts draws them).
export const SIGN_IN_CODE_LENGTH = 8
export const SIGN_IN_CODE_CHARACTERS = /[A-HJKMNP-Z2-9]/g

// Without a profile, "Inviter un adulte"; with one, "Connecter un appareil" for an adult without an account or a
// young profile.
// « Nouveau mot de passe » for another adult hands their account over: it goes with the admin's own proof.
export const createSignInCode = (profileId?: number, proof?: AdminProof) =>
  sendJson<{ code: string; expiresAt: number }>(
    'POST',
    '/codes',
    profileId === undefined ? {} : { profileId, ...proof }
  )

// What "Rejoins <foyer>" and "Ton profil t'attend" show of a profile, before any session.
export type CodeProfile = Pick<Profile, 'id' | 'name' | 'color' | 'kind' | 'avatar'>

export type CodeUse =
  | { kind: 'invite'; household: string; invitedBy: CodeProfile | null; full: boolean }
  | { kind: 'profile'; household: string; profile: CodeProfile }
  | { kind: 'device'; household: string; profile: CodeProfile }
  | { kind: 'reset'; household: string; profile: CodeProfile }

export const checkSignInCode = (code: string) => sendJson<CodeUse>('POST', '/codes/check', { code })

// The account, and for an invitation the new profile; this device is then signed in with both.
// existing: « J'ai déjà un compte », that account's e-mail and password instead of a new account.
export const joinWithCode = (join: {
  code: string
  email: string
  password: string
  ageConfirmed?: true
  existing?: true
  profile?: { name: string; color: ProfileColor }
  // signIn false: the account has « Validation en deux étapes », so this device signs in on Connexion with its code.
}) => sendJson<{ profileId: number; signIn?: false }>('POST', '/codes/join', join)

// A young profile's code: this device opens that profile only, from now on.
export const linkWithCode = (code: string) => sendJson<{ profileId: number }>('POST', '/codes/link', { code })

// "Mot de passe oublié": the account's new password; its other devices sign in again, this one is signed in.
export const resetWithCode = (code: string, password: string) =>
  sendJson<{ profileId: number; signIn?: false }>('POST', '/codes/reset', { code, password })

// « Mot de passe oublié »: the link by e-mail. The answer is the same whether an account has the address or not.
export const askResetLink = (email: string) => sendJson<object>('POST', '/password/forgot', { email })

// The link's account, while the link works.
export const checkResetLink = (token: string) => sendJson<{ email: string }>('POST', '/password/check', { token })

// The new password: every other device of the account signs in again; this one is signed in.
export const resetWithLink = (token: string, password: string) =>
  sendJson<{ signIn: false } | null>('POST', '/password/reset', { token, password })

// A young profile's own devices, in its form (Réglages > Profils).
export interface ProfileDevice {
  id: number
  userAgent: string
  lastSeenAt: number
}

export const getProfileDevices = async (profileId: number) =>
  (await getJson<{ devices: ProfileDevice[] }>(`/profiles/${profileId}/devices`)).devices

export const removeProfileDevice = (profileId: number, deviceId: number) =>
  sendJson<null>('DELETE', `/profiles/${profileId}/devices/${deviceId}`)

export interface HouseholdSetup {
  name: string
  profile: { name: string; color: ProfileColor }
  timeZone: string
  country: string | null
  language: InterfaceLanguage
  ai: { provider: string; key: string } | null
}

// Opens the admin's profile on this device, signed in with its account.
export const setUpHousehold = (setup: HouseholdSetup) => sendJson<{ profileId: number | null }>('POST', '/setup', setup)

export interface Household {
  name: string
  timeZone: string
  country: string | null
  language: InterfaceLanguage
  hourCycle: 12 | 24
  // Its photo's address; null: its initial shows.
  photo: string | null
  ai: { provider: string; providerName: string; model: string; keyHint: string } | null
  providers: AiProviderInfo[]
}

export const getHousehold = () => getJson<Household>('/household')

export const updateHousehold = (changes: {
  name?: string
  timeZone?: string
  country?: string | null
  language?: InterfaceLanguage
  hourCycle?: 12 | 24
}) => sendJson<Household>('PATCH', '/household', changes)

export const uploadHouseholdPhoto = async (photo: Blob) => {
  const response = await fetch('/api/household/photo', {
    method: 'PUT',
    headers: { 'Content-Type': photo.type },
    body: photo
  })
  if (response.status === 401) throw new UnauthorizedError('Session expired')
  if (!response.ok) throw new Error(`PUT household photo failed with status ${response.status}`)
  return (await response.json()) as Household
}

export const removeHouseholdPhoto = () => sendJson<Household>('DELETE', '/household/photo')

export const checkAiKey = async (provider: string, key: string) =>
  (await sendJson<{ result: KeyCheck }>('POST', '/household/ai/check', { provider, key })).result

// Kept only once the provider took it.
export const setHouseholdAi = (provider: string, key: string) =>
  sendJson<Household>('PUT', '/household/ai', { provider, key })

export const removeHouseholdAi = () => sendJson<Household>('DELETE', '/household/ai')
