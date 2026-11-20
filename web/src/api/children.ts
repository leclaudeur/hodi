import type { ProfileAvatarName, ProfileColor } from './profiles.ts'
import { getJson, sendJson } from './http.ts'

// Mon compte › Mes enfants: the teens' and children's accounts a parent runs. Mirrors server/http/young-account-routes.ts.

export interface ChildAccount {
  accountId: number
  profileId: number
  name: string
  color: ProfileColor
  kind: 'teen' | 'child'
  avatar: ProfileAvatarName | null
  photoVersion: number | null
  handle: string | null
  // false until a parent gives one: it opens only on a device where a parent is signed in.
  hasPassword: boolean
  parents: string[]
}

export interface NewChild {
  kind: 'teen' | 'child'
  name: string
  color: ProfileColor
  avatar?: ProfileAvatarName
  handle?: string
  password: string
}

export const getChildren = () => getJson<{ children: ChildAccount[] }>('/account/children')

export const createChild = (child: NewChild) => sendJson<ChildAccount>('POST', '/account/children', child)

// password, and code with « Validation en deux étapes » on: the parent's own, typed again.
export const setChildPassword = (accountId: number, newPassword: string, proof: { password: string; code?: string }) =>
  sendJson<ChildAccount>('PUT', `/account/children/${accountId}/password`, { newPassword, ...proof })
