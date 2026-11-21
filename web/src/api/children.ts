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
  // Oldest first; you: the parent looking.
  parents: ChildParent[]
  // The adult invited to be its parent too, while it has not answered.
  invited: { name: string; handle: string | null } | null
}

export interface ChildParent {
  accountId: number
  name: string
  handle: string | null
  since: number
  you: boolean
}

// Another parent asks this adult to be a young one's parent too.
export interface ParentInvitation {
  childId: number
  childName: string
  childHandle: string | null
  from: string
  createdAt: number
}

type Proof = { password: string; code?: string }

export interface NewChild {
  kind: 'teen' | 'child'
  name: string
  color: ProfileColor
  avatar?: ProfileAvatarName
  handle?: string
  password: string
}

export const getChildren = () =>
  getJson<{ children: ChildAccount[]; invitations: ParentInvitation[] }>('/account/children')

export const createChild = (child: NewChild) => sendJson<ChildAccount>('POST', '/account/children', child)

// password, and code with « Validation en deux étapes » on: the parent's own, typed again.
export const setChildPassword = (accountId: number, newPassword: string, proof: Proof) =>
  sendJson<ChildAccount>('PUT', `/account/children/${accountId}/password`, { newPassword, ...proof })

// The young one's card › Parents.
export const inviteParent = (accountId: number, handle: string) =>
  sendJson<ChildAccount>('POST', `/account/children/${accountId}/parents`, { handle })

export const cancelParentInvitation = (accountId: number) =>
  sendJson<ChildAccount>('DELETE', `/account/children/${accountId}/parents/invitation`)

export const stopBeingParent = (accountId: number, proof: Proof) =>
  sendJson<null>('DELETE', `/account/children/${accountId}/parents/me`, proof)

// The invited adult's answer.
export const acceptParentInvitation = (childId: number) =>
  sendJson<ChildAccount>('POST', `/account/children/invitations/${childId}`)

export const refuseParentInvitation = (childId: number) =>
  sendJson<null>('DELETE', `/account/children/invitations/${childId}`)
