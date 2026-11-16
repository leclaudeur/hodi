import { getJson, sendJson } from './http.ts'
import type { PluginTranslations } from '../plugins/plugin-texts.ts'

// Serveur › Notifications: the kinds of events the server tells its admin of, and how each reaches them.
export interface ServerNoticeKind {
  // « core:weekly-report », « plugin:village:household ».
  id: string
  // The core's kind (named by the app's texts) or the plugin's own type.
  key: string
  // null for the core's own kinds.
  plugin: { id: string; name: string; translations: PluginTranslations } | null
  // A plugin's texts, from its manifest, and in other languages from its locales.
  label: string | null
  hint: string | null
  translations: Record<string, { label?: string; hint?: string }>
  email: boolean
  push: boolean
}

export interface ServerNotices {
  // false: Serveur › E-mail is not set, and the e-mail boxes wait for it.
  mail: boolean
  // null: push is off on this server.
  publicKey: string | null
  kinds: ServerNoticeKind[]
}

export const getServerNotices = () => getJson<ServerNotices>('/server/notifications')

export const chooseServerNotice = (id: string, choice: { email: boolean; push: boolean }) =>
  sendJson<void>('PUT', `/server/notifications/kinds/${encodeURIComponent(id)}`, choice)

export const addServerPushDevice = (target: PushSubscriptionJSON) =>
  sendJson<void>('PUT', '/server/notifications/device', { target })

export const removeServerPushDevice = (endpoint: string) =>
  sendJson<void>('DELETE', '/server/notifications/device', { endpoint })
