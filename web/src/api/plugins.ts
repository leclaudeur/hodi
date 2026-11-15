import type { PluginInfo } from '../plugins/registry.ts'
import type { PluginTranslations } from '../plugins/plugin-texts.ts'
import type { CatalogPlugin } from '../plugins/catalog.ts'
import { RequestError, UnauthorizedError, getJson, sendJson } from './http.ts'

// Serveur › Plugins (server/http/plugin-routes.ts).
export const getPlugins = async () => (await getJson<{ plugins: PluginInfo[] }>('/plugins')).plugins

export const updatePlugin = (id: string, change: { enabled?: boolean; settings?: Record<string, unknown> }) =>
  sendJson<PluginInfo>('PATCH', `/plugins/${encodeURIComponent(id)}`, change)

// What a plugin declared it may ask of Hodi: anything else is refused.
export interface PluginPermissions {
  network: string[]
  articles: boolean
  households?: boolean
  accounts?: boolean
  signIn?: boolean
  publicRoutes?: boolean
  mail?: boolean
  notify?: boolean
  ai?: boolean
}

// A package the admin sent, unpacked apart until it is installed (15 minutes at most).
export interface StagedPlugin {
  token: string
  id: string
  name: string
  version: string
  description: string
  translations: PluginTranslations
  audience: 'admin' | 'all'
  provides: string[]
  permissions: PluginPermissions
  feeds?: { name: string; site: string }[]
  signed: boolean
  // Signed-only permissions an unsigned package asks for: it cannot be installed.
  signedOnly?: string[]
  bytes: number
  // The version installed now, when this package replaces it.
  replaces: string | null
}

export const stagePlugin = async (file: Blob): Promise<StagedPlugin> => {
  const response = await fetch('/api/plugins/packages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file
  })
  if (response.status === 401) throw new UnauthorizedError('Session expired')
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new RequestError(response.status, body?.error ?? null, null)
  }
  return (await response.json()) as StagedPlugin
}

// Hodi's plugin registry, as the server read it, and one of its plugins downloaded and checked by the server: then the
// same questions as for a file.
export const getCatalog = async () => (await getJson<{ plugins: CatalogPlugin[] }>('/plugins/catalog')).plugins

export const stageFromCatalog = (id: string) =>
  sendJson<StagedPlugin>('POST', `/plugins/catalog/${encodeURIComponent(id)}/stage`)

// Hodi restarts once it answered.
// What a person types before what cannot be undone: their password, and with « Validation en deux étapes » on their
// app's code (empty otherwise).
export interface AdminProof {
  password: string
  code: string
}

// Serveur › Comptes and Foyers: « Supprimer », with the server admin's password and app code. An account goes with its
// profiles; a household with its profiles and the accounts that read nowhere else.
export const deleteServerAccount = (id: number, proof: AdminProof) =>
  sendJson<null>('DELETE', `/server/accounts/${id}`, proof)
export const deleteServerHousehold = (id: number, proof: AdminProof) =>
  sendJson<null>('DELETE', `/server/households/${id}`, proof)

export const installPlugin = (token: string, acceptUnsigned: boolean, proof?: AdminProof) =>
  sendJson<{ installed: string; version: string }>('POST', `/plugins/packages/${encodeURIComponent(token)}/install`, {
    acceptUnsigned,
    ...proof
  })

// withData: its database and settings go too; otherwise they stay for a reinstall.
// Serveur › Plugins › Mode développeur, for « npx hodi-plugin dev ».
export const getDevMode = async () => getJson<{ on: boolean }>('/plugins/dev-mode')
export const startDevMode = (proof?: AdminProof) =>
  sendJson<{ on: true; code: string }>('POST', '/plugins/dev-mode', proof)
export const stopDevMode = () => sendJson<{ on: false; restarting: boolean }>('DELETE', '/plugins/dev-mode')

export const removePlugin = (id: string, withData = false, proof?: AdminProof) =>
  sendJson<{ removed: string }>('DELETE', `/plugins/${encodeURIComponent(id)}${withData ? '?data=delete' : ''}`, proof)
