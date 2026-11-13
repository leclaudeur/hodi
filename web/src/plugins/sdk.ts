import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { RequestError, secondStep } from '../api.ts'
import { type Confirmation, type Proof, askToConfirm as askHodi } from '../lib/confirm.ts'
import { t as hodiT } from '../lib/i18n.ts'
import { hasNoPassword } from '../lib/two-factor.ts'
import { pluginNamespace, registerWebPlugin, usePluginCapability, type WebPlugin } from './registry.ts'

export type {
  AfterSignInProps,
  AgeConsent,
  AvatarMenuItem,
  OverviewCardSlot,
  ReaderArticle,
  ServerSection,
  SetupStep,
  SetupStepProps,
  SignedOutPageProps
} from './registry.ts'
import { usePluginId } from './scope.ts'

// hodi:sdk, what a plugin's web.js imports: Hodi's own components, so a plugin looks like the rest of Hodi, and a few
// hooks scoped to the plugin. Plugins are built against it with React, react/jsx-runtime and react-dom left out
// (see host.ts). What is here is the plugin API: removing or changing a name needs a new major version of it.

// The violet button that asks the household's AI through the plugin's aiActions (ctx.ai on the server).
export { default as AiButton } from './AiButton.tsx'
// « J'ai au moins 13 ans » and every plugin's consent line after it, as on « J'ai un code ».
export { default as AgeCheckbox } from './AgeCheckbox.tsx'
export type { AiButtonError } from './AiButton.tsx'
export { default as Button } from '../ui/Button.tsx'
export { default as Checkbox } from '../ui/Checkbox.tsx'
export { default as Chip } from '../ui/Chip.tsx'
export { default as Dialog } from '../ui/Dialog.tsx'
export { default as DialogActions } from '../ui/DialogActions.tsx'
export { default as EmptyState } from '../ui/EmptyState.tsx'
export { default as FilterChip } from '../ui/FilterChip.tsx'
export { default as HouseholdAvatar } from '../ui/HouseholdAvatar.tsx'
// « Voir les 4 autres », the last row of a list's card that shows its first few.
export { default as MoreRow } from '../ui/MoreRow.tsx'
export { default as Notice } from '../ui/Notice.tsx'
// A card of Serveur › Vue d'ensemble, as Hodi's own: its title, a count beside it, a chip at the end, then the plugin's.
export { default as OverviewCard } from './OverviewCard.tsx'
// A password's pill with its eye; for a new one, the strength ring in its icon's place (lead) and the line under it
// while it is weak, as on Hodi's own forms.
export { default as PasswordField } from '../ui/PasswordField.tsx'
// PasswordGauge, its name since 0.5: plugins that put it under a new password get the hint line.
export { PasswordHint as PasswordGauge, PasswordRing } from '../ui/PasswordGauge.tsx'
export type { NoticeAction, NoticeTone } from '../ui/Notice.tsx'
// One box per character of a code (« J'ai un code »'s 8, an authenticator app's 6).
export { default as PinField } from '../ui/PinField.tsx'
export type { PinState } from '../ui/PinField.tsx'
export { default as RoundButton } from '../ui/RoundButton.tsx'
// One choice among a few in a pill, as SettingRow's choice (« Clair · Sombre · Système »).
export { default as Segmented } from '../ui/Segmented.tsx'
export { default as SourceAvatar } from '../ui/SourceAvatar.tsx'
export { default as StatusLine } from '../ui/StatusLine.tsx'
export { default as TextField } from '../ui/TextField.tsx'
export { default as Toggle } from '../ui/Toggle.tsx'
export { default as SectionPage } from '../views/settings/SectionPage.tsx'
export { default as ReaderButton } from '../views/reader/ReaderButton.tsx'
export { default as SetupActions } from './SetupActions.tsx'
// A full-page step as the setup's, outside the setup (a plugin's sign-up before sign-in).
export { default as StepPage } from './StepPage.tsx'
// A choice drawn as « Qui lit ? » draws the profiles (« Quel foyer ? »).
export { default as TilesPage } from './TilesPage.tsx'
export type { Tile } from './TilesPage.tsx'
export { default as SettingRow } from '../views/settings/SettingRow.tsx'
export { default as SettingsCard } from '../views/settings/SettingsCard.tsx'
export type { Confirmation, Proof } from '../lib/confirm.ts'
export { showDone, showError, showSaved } from '../lib/toast.ts'
// "40 MIN", "3 H", "2 J", as cards date an article.
export { shortAgo } from '../lib/format.ts'
export { usePluginCapability }

export const definePlugin = (definition: WebPlugin) => registerWebPlugin(definition)

// Hodi's question before what cannot be undone. With proof, it asks the person's own password (and with « Validation en
// deux étapes » the app's code; an account with no password, the code only): onConfirm gets them to pass on as
// api(path, { proof }) to a route marked proof: true, and a wrong one keeps the dialog open.
export const askToConfirm = (confirmation: Confirmation) =>
  askHodi(confirmation.proof ? { ...confirmation, proof: { noPassword: hasNoPassword() } } : confirmation)

// What a request to the plugin's routes takes: fetch's, and the proof typed in askToConfirm's dialog.
export type PluginRequestInit = RequestInit & { proof?: Proof }

// The refusals of a route marked proof: true that the dialog shows itself (a wrong password, a wrong code…).
const PROOF_REFUSALS = new Set([
  'invalid_password',
  'invalid_code',
  'sign_in_again',
  'too_many_attempts',
  'proof_required',
  'account_only'
])

// Any password fits in a header as base64 of its JSON's UTF-8 bytes.
const proofHeader = ({ password, code }: Proof) => {
  const bytes = new TextEncoder().encode(JSON.stringify({ password, code }))
  return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''))
}

const send = async (url: string, init: PluginRequestInit = {}) => {
  const { proof, ...rest } = init
  if (!proof) return fetch(url, rest)
  const headers = new Headers(rest.headers)
  headers.set('Hodi-Proof', proofHeader(proof))
  const answer = await fetch(url, { ...rest, headers })
  if (answer.status === 403 || answer.status === 429) {
    const body = (await answer
      .clone()
      .json()
      .catch(() => null)) as { error?: string; retryAfterSeconds?: number } | null
    if (body?.error && PROOF_REFUSALS.has(body.error))
      throw new RequestError(answer.status, body.error, body.retryAfterSeconds ?? null)
  }
  return answer
}

// A plugin signed in an account with « Validation en deux étapes » on: Hodi asks for the app's code in its own
// dialog, and the device signs in once it is right. Resolves either way: closed, the device stays signed out.
const askSecondStep = (ticket: string) =>
  new Promise<void>(resolve =>
    askHodi({
      title: hodiT('twoFactor.pluginSignIn.title'),
      message: hodiT('twoFactor.pluginSignIn.message'),
      label: hodiT('twoFactor.pluginSignIn.button'),
      look: 'primary',
      proof: { codeOnly: true },
      onConfirm: async ({ code }) => {
        await secondStep(ticket, code)
        resolve()
      },
      onCancel: resolve
    })
  )

// The plugin's own texts, from its locales/: t('hello') never reads Hodi's.
export const usePluginTranslation = () => {
  const namespace = pluginNamespace(usePluginId())
  // Hodi's keys are typed against fr.json; a plugin's are its own, so its t takes any key. useTranslation() still
  // draws the plugin again when the language changes.
  const { i18n } = useTranslation()
  const { language } = i18n
  const t = useMemo(
    () =>
      (key: string, options: Record<string, unknown> = {}): string =>
        String(i18n.t(key as never, { ...options, ns: namespace, lng: language } as never)),
    [i18n, namespace, language]
  )
  return { t, language }
}

// A request to the plugin's own routes: api('/hi') asks /api/plugins/<id>/hi. With proof (from askToConfirm), a
// wrong password or code throws, for the dialog to show.
export const usePluginApi = () => {
  const id = usePluginId()
  return useCallback(
    (path: string, init?: PluginRequestInit) => send(`/api/plugins/${encodeURIComponent(id)}${path}`, init),
    [id]
  )
}

// A request to the plugin's routes open to anyone, from its screens before sign-in: publicApi('/signup') asks
// /api/public/plugins/<id>/signup. An answer with signIn sets the session's cookies: then call signedIn(). For an
// account with « Validation en deux étapes » on, Hodi first asks for the app's code, and the answer comes after.
export const usePluginPublicApi = () => {
  const id = usePluginId()
  return useCallback(
    async (path: string, init?: RequestInit) => {
      const answer = await fetch(`/api/public/plugins/${encodeURIComponent(id)}${path}`, init)
      const ticket = answer.headers.get('Hodi-Second-Step')
      if (ticket) await askSecondStep(ticket)
      return answer
    },
    [id]
  )
}

// A request to the plugin's routes for the server's space, from its sections of /server: serverApi('/waitlist')
// asks /api/server/plugins/<id>/waitlist, which only the server's admin reaches.
export const usePluginServerApi = () => {
  const id = usePluginId()
  return useCallback(
    (path: string, init?: PluginRequestInit) => send(`/api/server/plugins/${encodeURIComponent(id)}${path}`, init),
    [id]
  )
}

// Hodi's addresses and the plugin's own screens: a plugin links through these, never by writing an address.
export { navigate, usePluginLinks, usePluginPath } from './links.ts'
// Serveur › Contenu and Sauvegardes, read only, signed in or not: the numbers a plugin's legal pages say.
export { useServerSettings } from './server-settings.ts'
export type { ServerSettings } from './server-settings.ts'
// Serveur › Foyers and Comptes, read only, for the server's admin: households, accounts and when each was last used.
export { useServerAccounts, useServerHouseholds } from './server-people.ts'
export type { ServerAccountSummary, ServerHouseholdSummary } from './server-people.ts'
export type { PluginLinks } from './links.ts'
