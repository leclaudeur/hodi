import { RequestError, getJson, sendJson } from './http.ts'
import type { AdminProof } from './plugins.ts'
import type { ReportReason, ShareReportReason } from './sources.ts'

// Serveur › Vue d'ensemble: every profile together, totals only, day by day (YYYY-MM-DD).
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
  profiles: { adults: number; young: number }
  // The first day with numbers: « Tout » starts there.
  since: string
  days: ServerDay[]
  // The same number of days just before, day by day (empty when the server has no numbers that far back).
  previous: ServerDay[]
  topics: { id: string; count: number }[]
  sources: { id: string; name: string; count: number }[]
  // Who has Hodi open now: a first name and the kind of device, since when (ms).
  online: { name: string; device: 'phone' | 'tablet' | 'computer'; since: number }[]
}

// The last `days` days (0: everything), or any two dates (YYYY-MM-DD).
export const getServerOverview = (period: { days: number } | { from: string; to: string }) =>
  getJson<ServerOverview>(
    `/server/overview?${'from' in period ? `from=${period.from}&to=${period.to}` : `days=${period.days}`}`
  )

// Serveur › Comptes: who has an account, never what anyone reads.
export interface ServerAccount {
  id: number
  email: string
  serverAdmin: boolean
  createdAt: number
  // photoVersion: null when it has no photo, the initial shows.
  profile: {
    id: number
    name: string
    role: 'admin' | 'member'
    kind: 'adult' | 'teen' | 'child'
    photoVersion: number | null
  } | null
  lastSeenAt: number | null
  devices: number
  // « Mot de passe oublié » on a server without e-mail: when the person asked for a code, until one is made.
  codeAskedAt: number | null
}

// Serveur › Notifications: what the server told its admins, in each language. important: a request someone waits on,
// « À traiter » until handled.
export interface InboxItem {
  id: number
  type: string
  texts: Partial<Record<'fr' | 'en', { from: string; title: string; text: string }>>
  url: string
  important: boolean
  createdAt: number
  handledAt: number | null
}

export const getServerInbox = () => getJson<{ items: InboxItem[]; waiting: number }>('/server/inbox')

export const getServerAccounts = async () => (await getJson<{ accounts: ServerAccount[] }>('/server/accounts')).accounts

// « Inviter quelqu'un » under Comptes, and "Mot de passe oublié" for an account: « J'ai un code » codes.
export const createInviteCode = () => sendJson<{ code: string; expiresAt: number }>('POST', '/server/invite')

// It opens that person's account: with the server admin's own password and app code.
export const createAccountCode = (id: number, proof: AdminProof) =>
  sendJson<{ code: string; expiresAt: number }>('POST', `/server/accounts/${id}/code`, proof)

// « Nommer admin du serveur », with the admin's own password and app code.
export const makeServerAdmin = (id: number, proof: AdminProof) =>
  sendJson<null>('POST', `/server/accounts/${id}/server-admin`, proof)

// Serveur › Contenu: how long the server keeps what it fetches, in days, with each one's bounds.
export type ContentKey = 'articleDays' | 'videoDays' | 'textDays'
export interface ServerContent {
  values: Record<ContentKey, number>
  bounds: Record<ContentKey, { min: number; max: number; byDefault: number }>
  // How many sources a person may follow (null: no limit), and the bounds of a number.
  maxSources: { value: number | null; min: number; max: number }
}

export const getServerContent = () => getJson<ServerContent>('/server/content')

export const setServerContent = (changes: Partial<Record<ContentKey, number> & { maxSources: number | null }>) =>
  sendJson<ServerContent>('PATCH', '/server/content', changes)

// Serveur › Général: Hodi's own address, for the links of its e-mails, and the public site a first visit goes to.
export interface ServerGeneral {
  appUrl: string | null
  publicHome: string | null
}

export const getServerGeneral = () => getJson<ServerGeneral>('/server/general')

export const setServerGeneral = (changes: Partial<ServerGeneral>) =>
  sendJson<ServerGeneral>('PUT', '/server/general', changes)

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
  // The password made a link that works once: the browser downloads the copy itself, with its own progress, and the
  // server names the file (a zip when the plugins' data comes with it).
  const { link } = (await response.json()) as { link: string }
  const anchor = document.createElement('a')
  anchor.href = link
  anchor.download = ''
  anchor.click()
}

// Serveur › E-mail: the mail server Hodi sends through. Its password never comes back, only whether there is one.
export type MailSecurity = 'tls' | 'starttls' | 'none'

// Filled one row at a time: ready once the server and the sender are both there.
export interface ServerMail {
  host: string | null
  port: number
  security: MailSecurity
  user: string | null
  hasPassword: boolean
  sender: string | null
  ready: boolean
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

// One row of Serveur › E-mail: only the fields given change.
export const changeServerMail = (changes: Partial<Omit<ServerMailDraft, 'appUrl'>>) =>
  sendJson<{ mail: ServerMail }>('PATCH', '/server/mail', changes).then(({ mail }) => mail)

export const removeServerMail = () => sendJson<{ mail: null }>('DELETE', '/server/mail')

// « Envoyer un essai »: to the admin's own address, which comes back.
export const sendTestMail = () => sendJson<{ to: string }>('POST', '/server/mail/test')

// À traiter's sources: those that wait for the server's admin, never with who added them.
export interface SourceReview {
  id: string
  name: string
  site: string
  kind: 'article' | 'video' | 'podcast'
  lang: 'fr' | 'en'
  description: string | null
  topicIds: string[]
  askedAt: number
}

export const getSourceReviews = () => getJson<{ validating: boolean; sources: SourceReview[] }>('/server/reviews')

export const setSourceValidation = (on: boolean) =>
  sendJson<{ validating: boolean }>('PUT', '/server/reviews/validation', { on })

export const decideSource = (
  id: string,
  decision: { decision: 'accept' | 'refuse'; topicIds?: string[]; teen: boolean; child: boolean }
) => sendJson<null>('POST', `/server/reviews/sources/${encodeURIComponent(id)}`, decision)

// À traiter's reports: a source, how many reported it and why, never who.
export interface SourceReportView {
  id: string
  name: string
  site: string
  kind: 'article' | 'video' | 'podcast'
  lang: 'fr' | 'en'
  description: string | null
  count: number
  reasons: Record<ReportReason, number>
  lastAt: number
}

export const getSourceReports = () => getJson<{ reports: SourceReportView[] }>('/server/reports')

// Ignorer keeps the source; Retirer du catalogue takes it out for those who do not read it yet.
export const decideReport = (id: string, decision: 'ignore' | 'unlist') =>
  sendJson<null>('POST', `/server/reports/${encodeURIComponent(id)}`, { decision })

// A share someone reported, as it was received, and its sender's account (null once deleted); never who reported it.
export interface ShareReportView {
  id: number
  sender: number | null
  senderName: string
  item: { title: string; sourceName: string; link: string; kind: string }
  note: string | null
  reason: ShareReportReason
  day: number
}

export const getShareReports = () => getJson<{ reports: ShareReportView[] }>('/server/share-reports')

export const ignoreShareReport = (id: number) =>
  sendJson<null>('POST', `/server/share-reports/${id}`, { decision: 'ignore' })

// What « Bloquer » takes, said before the password: its domain (or on a shared host, its feed's address), how many
// sources go, and whether the account that added it goes.
export const getBlockPreview = (id: string) =>
  getJson<{ target: string; sources: number; account: boolean }>(`/server/sources/${encodeURIComponent(id)}/block`)

// « Bloquer » a source, for illegal content, with the admin's password and app code.
export const blockSource = (id: string, proof: AdminProof) =>
  sendJson<{ target: string }>('POST', `/server/sources/${encodeURIComponent(id)}/block`, proof)

export interface BlockedDomain {
  domain: string
  at: number
}

// Blocages: the domains blocked, the latest first.
export const getBlocks = () => getJson<{ domains: BlockedDomain[] }>('/server/blocks')

// « Débloquer »: someone may add it again; nothing erased comes back.
export const unblockDomain = (domain: string, proof: AdminProof) =>
  sendJson<null>('DELETE', `/server/blocks/${encodeURIComponent(domain)}`, proof)

// « Débloquer une adresse »: an account blocked by mistake may come back.
export const unblockEmail = (email: string, proof: AdminProof) =>
  sendJson<null>('POST', '/server/accounts/unblock', { email, ...proof })
