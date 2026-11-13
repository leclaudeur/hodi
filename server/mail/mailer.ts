import { createTransport } from 'nodemailer'
import type { MailSettings } from '../db/mail-settings-store.ts'

// Sends one e-mail through the mail server of Serveur › E-mail. Tests give a fake instead.

export interface MailMessage {
  to: string
  subject: string
  text: string
}

// Why a send failed, in words the admin can act on: the server cannot be reached (host, port, security), it refused
// the user name or password, or it refused the message (often the sender's address).
export type MailFailure = 'unreachable' | 'auth' | 'refused'

export class MailError extends Error {
  readonly reason: MailFailure

  constructor(reason: MailFailure, cause?: unknown) {
    super(`mail ${reason}`, { cause })
    this.reason = reason
  }
}

export type SendMail = (settings: MailSettings, message: MailMessage) => Promise<void>

// A slow server does not keep the admin's request waiting long.
const TIMEOUT_MS = 15_000

const failureOf = (error: unknown): MailFailure => {
  const code = (error as { code?: unknown })?.code
  if (code === 'EAUTH') return 'auth'
  if (code === 'EENVELOPE' || code === 'EMESSAGE') return 'refused'
  return 'unreachable'
}

export const smtpSend: SendMail = async (settings, message) => {
  const transport = createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.security === 'tls',
    requireTLS: settings.security === 'starttls',
    ignoreTLS: settings.security === 'none',
    auth: settings.user ? { user: settings.user, pass: settings.password ?? '' } : undefined,
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS
  })
  try {
    await transport.sendMail({ from: settings.sender, ...message })
  } catch (error) {
    throw new MailError(failureOf(error), error)
  } finally {
    transport.close()
  }
}
