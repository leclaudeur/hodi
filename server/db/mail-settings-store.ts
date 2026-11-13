import type { Database } from './database.ts'
import { cleanEmail } from './user-account-store.ts'

// Serveur › E-mail: the mail server Hodi sends its e-mails through. Until it is filled in, Hodi sends none.

// tls: encrypted from the first byte (usually port 465). starttls: plain, then encrypted before anything is sent
// (usually 587), and refused if the server cannot. none: never encrypted, for a relay on the same machine.
export const MAIL_SECURITY = ['tls', 'starttls', 'none'] as const
export type MailSecurity = (typeof MAIL_SECURITY)[number]

export const MAX_HOST_LENGTH = 253
export const MAX_USER_LENGTH = 254
export const MAX_MAIL_PASSWORD_LENGTH = 256

export interface MailSettings {
  host: string
  port: number
  security: MailSecurity
  // Both null: the server takes mail without signing in.
  user: string | null
  password: string | null
  // The address the e-mails come from.
  sender: string
  // Where Hodi is reached from outside, for the links the e-mails carry; null until the admin gives it.
  appUrl: string | null
  updatedAt: number
}

interface MailRow {
  host: string
  port: number
  security: string
  user: string | null
  password: string | null
  sender: string
  app_url: string | null
  updated_at: number
}

export const isMailSecurity = (value: unknown): value is MailSecurity =>
  typeof value === 'string' && (MAIL_SECURITY as readonly string[]).includes(value)

// A host name or an address as typed, without a scheme, a path or spaces; null when it cannot be one.
export const cleanHost = (value: unknown) => {
  if (typeof value !== 'string') return null
  const host = value.trim().toLowerCase()
  return host.length > 0 && host.length <= MAX_HOST_LENGTH && /^[a-z0-9.:[\]-]+$/.test(host) ? host : null
}

export const isPort = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 65_535

// Hodi's address as the admin typed it, down to its origin ("https://hodi.example.com"); null when it is not one.
export const cleanAppUrl = (value: unknown) => {
  if (typeof value !== 'string' || value.length > MAX_HOST_LENGTH + 16) return null
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null
  } catch {
    return null
  }
}

// What the admin sends to change it: everything but the password, which, when absent, stays as it was.
export interface MailDraft {
  host: string
  port: number
  security: MailSecurity
  user: string | null
  // undefined: keep the one saved.
  password?: string | null
  sender: string
  // undefined: keep the one saved.
  appUrl?: string
}

// The draft from a request's body, or null when a field is missing or wrong.
export const mailDraftOf = (body: Record<string, unknown>): MailDraft | null => {
  const host = cleanHost(body.host)
  const sender = cleanEmail(body.sender)
  const user = typeof body.user === 'string' ? body.user.trim() : body.user
  if (!host || !sender || !isPort(body.port) || !isMailSecurity(body.security)) return null
  if (user !== null && user !== undefined && (typeof user !== 'string' || user.length > MAX_USER_LENGTH)) return null
  const appUrl = body.appUrl === undefined ? undefined : cleanAppUrl(body.appUrl)
  if (appUrl === null) return null
  const { password } = body
  if (
    password !== undefined &&
    password !== null &&
    (typeof password !== 'string' || password.length === 0 || password.length > MAX_MAIL_PASSWORD_LENGTH)
  )
    return null
  return {
    host,
    port: body.port,
    security: body.security,
    user: user ? user : null,
    ...(password === undefined ? {} : { password }),
    sender,
    ...(appUrl === undefined ? {} : { appUrl })
  }
}

export class MailSettingsStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  get(): MailSettings | null {
    const row = this.#db
      .prepare('SELECT host, port, security, user, password, sender, app_url, updated_at FROM server_mail WHERE id = 1')
      .get() as MailRow | undefined
    if (!row || !isMailSecurity(row.security)) return null
    return {
      host: row.host,
      port: row.port,
      security: row.security,
      user: row.user,
      password: row.password,
      sender: row.sender,
      appUrl: row.app_url,
      updatedAt: row.updated_at
    }
  }

  // « Mot de passe oublié » needs both: a way to send, and the address its link opens.
  canSendLinks() {
    return this.get()?.appUrl != null
  }

  // The saved settings. Without a user name there is no password either.
  set(draft: MailDraft, now: number): MailSettings {
    const saved = this.get()
    const password =
      draft.user === null ? null : draft.password === undefined ? (saved?.password ?? null) : draft.password
    const appUrl = draft.appUrl ?? saved?.appUrl ?? null
    this.#db
      .prepare(
        `INSERT INTO server_mail (id, host, port, security, user, password, sender, app_url, updated_at)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET host = excluded.host, port = excluded.port, security = excluded.security,
           user = excluded.user, password = excluded.password, sender = excluded.sender, app_url = excluded.app_url,
           updated_at = excluded.updated_at`
      )
      .run(draft.host, draft.port, draft.security, draft.user, password, draft.sender, appUrl, now)
    return this.get()!
  }

  clear() {
    this.#db.prepare('DELETE FROM server_mail').run()
  }
}
