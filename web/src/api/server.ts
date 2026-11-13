import { type Language as InterfaceLanguage } from '../lib/i18n.ts'
import { RequestError, getJson, sendJson } from './http.ts'
import type { AdminProof } from './plugins.ts'

// Serveur › Vue d'ensemble: every household and profile together, totals only, day by day (YYYY-MM-DD).
export interface ServerDay {
  day: string
  // Different profiles that opened Hodi.
  visits: number
  articles: number
  videos: number
  minutes: number
  shares: number
  // Profiles added.
  profiles: number
  // Personal accounts at the end of the day, and those used in the 30 days before it.
  accounts: number
  activeAccounts: number
}

export interface ServerOverview {
  households: number
  profiles: { adults: number; young: number }
  // The first day with numbers: « Tout » starts there.
  since: string
  days: ServerDay[]
  // The same number of days just before, day by day (empty when the server has no numbers that far back).
  previous: ServerDay[]
  topics: { id: string; count: number }[]
  sources: { id: string; name: string; count: number }[]
  // Who has Hodi open now: a first name, its household and the kind of device, since when (ms).
  online: { name: string; household: string; device: 'phone' | 'tablet' | 'computer'; since: number }[]
}

// The last `days` days (0: everything), or any two dates (YYYY-MM-DD).
export const getServerOverview = (period: { days: number } | { from: string; to: string }) =>
  getJson<ServerOverview>(
    `/server/overview?${'from' in period ? `from=${period.from}&to=${period.to}` : `days=${period.days}`}`
  )

// Serveur › Foyers and Comptes: who has an account and where, never what anyone reads.
export interface ServerHousehold {
  id: number
  name: string
  createdAt: number
  admin: string | null
  adults: number
  young: number
  accounts: number
  photoVersion: number | null
}

export interface ServerAccount {
  id: number
  email: string
  serverAdmin: boolean
  createdAt: number
  // photoVersion: null when it has no photo, the initial shows.
  profile: { id: number; name: string; role: 'admin' | 'member'; photoVersion: number | null } | null
  household: { id: number; name: string } | null
  lastSeenAt: number | null
  devices: number
}

export const getServerHouseholds = () =>
  getJson<{ households: ServerHousehold[]; maxProfiles: number; canCreate?: boolean }>('/server/households')

// No household yet. « Créer mon foyer »: the setup's household steps come back.
export const startHousehold = () => sendJson<null>('POST', '/server/households', { for: 'me' })

// « Créer un foyer » for someone else: its name, its admin's first name, and the code that person types.
export const createHouseholdFor = (household: { name: string; admin: string; language: InterfaceLanguage }) =>
  sendJson<{ profile: { id: number; name: string }; code: string; expiresAt: number }>('POST', '/server/households', {
    for: 'other',
    ...household
  })

export const getServerAccounts = async () => (await getJson<{ accounts: ServerAccount[] }>('/server/accounts')).accounts

// "Inviter un adulte" into a household, and "Mot de passe oublié" for an account: « J'ai un code » codes.
export const createHouseholdCode = (id: number) =>
  sendJson<{ code: string; expiresAt: number }>('POST', `/server/households/${id}/code`)

// « Refaire son code » for the admin of a household made for someone else, who has no account yet.
export const createHouseholdAdminCode = (id: number) =>
  sendJson<{ profile: { id: number; name: string }; code: string; expiresAt: number }>(
    'POST',
    `/server/households/${id}/admin-code`
  )

// It opens that person's account: with the server admin's own password and app code.
export const createAccountCode = (id: number, proof: AdminProof) =>
  sendJson<{ code: string; expiresAt: number }>('POST', `/server/accounts/${id}/code`, proof)

// Serveur › Contenu: how long the server keeps what it fetches, in days, with each one's bounds.
export type ContentKey = 'articleDays' | 'videoDays' | 'textDays'
export interface ServerContent {
  values: Record<ContentKey, number>
  bounds: Record<ContentKey, { min: number; max: number; byDefault: number }>
  // How many sources a household may follow (null: no limit), and the bounds of a number.
  maxSources: { value: number | null; min: number; max: number }
}

export const getServerContent = () => getJson<ServerContent>('/server/content')

export const setServerContent = (changes: Partial<Record<ContentKey, number> & { maxSources: number | null }>) =>
  sendJson<ServerContent>('PATCH', '/server/content', changes)

// Serveur › Sauvegardes: the copies of the whole database, the newest first.
export interface ServerBackups {
  copies: { name: string; at: number; bytes: number }[]
  kept: number
  bounds: { min: number; max: number; byDefault: number }
}

export const getServerBackups = () => getJson<ServerBackups>('/server/backups')

export const setBackupCopies = (kept: number) => sendJson<ServerBackups>('PATCH', '/server/backups', { kept })

export const backupNow = () => sendJson<ServerBackups>('POST', '/server/backups')

// The copy as a file to save, with the password of the account asking for it.
// « Restaurer »: the whole server goes back to that copy; Hodi restarts on it once it answered.
export const restoreBackup = (name: string, proof: AdminProof) =>
  sendJson<{ restarting: boolean }>('POST', `/server/backups/${encodeURIComponent(name)}/restore`, proof)

export const downloadBackup = async (name: string, proof: AdminProof) => {
  const response = await fetch(`/api/server/backups/${encodeURIComponent(name)}/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(proof)
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new RequestError(response.status, body?.error ?? null, null)
  }
  const link = document.createElement('a')
  link.href = URL.createObjectURL(await response.blob())
  // A copy with the plugins' data comes as a zip: the server names the file.
  link.download = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') ?? '')?.[1] ?? name
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 1000)
}

// Serveur › E-mail: the mail server Hodi sends through. Its password never comes back, only whether there is one.
export type MailSecurity = 'tls' | 'starttls' | 'none'

export interface ServerMail {
  host: string
  port: number
  security: MailSecurity
  user: string | null
  hasPassword: boolean
  sender: string
  appUrl: string | null
}

export interface ServerMailDraft {
  host: string
  port: number
  security: MailSecurity
  user: string | null
  // Absent: the one saved stays.
  password?: string | null
  sender: string
  // Where Hodi is reached from outside: the links of its e-mails open there.
  appUrl: string
}

export const getServerMail = () => getJson<{ mail: ServerMail | null }>('/server/mail').then(({ mail }) => mail)

export const setServerMail = (draft: ServerMailDraft) =>
  sendJson<{ mail: ServerMail }>('PUT', '/server/mail', draft).then(({ mail }) => mail)

export const removeServerMail = () => sendJson<{ mail: null }>('DELETE', '/server/mail')

// « Envoyer un essai »: to the admin's own address, which comes back.
export const sendTestMail = () => sendJson<{ to: string }>('POST', '/server/mail/test')
