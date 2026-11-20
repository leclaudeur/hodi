import { getJson, sendJson } from './http.ts'

// « Identifiant »: the @name of an account, unique on the server. Mirrors server/http/handle-routes.ts.

// Free, or taken and a free one like it. The account's own counts as free for it.
export const checkHandle = (handle: string) =>
  getJson<{ free: boolean; suggestion: string | null }>(`/handles/${encodeURIComponent(handle)}`)

// Mon compte: a new one, once every 30 days. changeableFrom: when it can change again, or null.
export const changeHandle = (handle: string) =>
  sendJson<{ handle: string; changeableFrom: number | null }>('PUT', '/account/handle', { handle })
