import { getJson, sendJson } from './http.ts'

// Réglages › Profils › Personnes invitées. Mirrors server/http/invitation-routes.ts.
export interface Invitation {
  id: number
  // null: an invitation made before invitations had a name.
  name: string | null
  email: string | null
  expiresAt: number
}

// mail: Serveur › E-mail is set, so « Inviter un adulte » can send the code to an address.
export const getInvitations = () => getJson<{ mail: boolean; invitations: Invitation[] }>('/codes/invitations')

// « Inviter un adulte »: sent is true when the code went by e-mail.
export const inviteAdult = (invite: { name: string; email?: string }) =>
  sendJson<{ code: string; expiresAt: number; sent: boolean }>('POST', '/codes', invite)

// « Renvoyer » and « Voir le code »: a code cannot be read back, so the invitation gets a new one, the old one stops.
export const renewInvitation = (id: number) =>
  sendJson<{ code: string; expiresAt: number; sent: boolean }>('POST', `/codes/invitations/${id}/code`)

export const cancelInvitation = (id: number) => sendJson<null>('DELETE', `/codes/invitations/${id}`)
