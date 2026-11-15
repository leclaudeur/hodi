import type { MailSettingsStore } from '../db/mail-settings-store.ts'
import { textsIn } from '../i18n.ts'
import type { SendMail } from '../mail/mailer.ts'
import type { Language } from '../../shared/i18n.ts'
import { HOUR_MS } from '../../shared/time.ts'

// ctx.mail: a plugin's e-mails, sent through Serveur › E-mail. The core builds every message itself from three
// fields, so nothing the plugin adds (a second recipient, a sender, HTML, an attachment that names a file on the
// server) reaches nodemailer, and it counts each plugin's e-mails here, in the main thread, where a restart of the
// plugin's thread cannot reset them.

// How many e-mails one plugin may send in an hour.
export const PLUGIN_MAILS_PER_HOUR = 50

const MAX_ADDRESS = 254
const MAX_SUBJECT = 200
const MAX_TEXT = 20_000
// One plain address, nothing around it: no display name, no list, no comment, no line break.
const ADDRESS =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/
// Any control character, line breaks included: a subject is one line.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = /[\u0000-\u001f\u007f]/
// The text may have line breaks, but no other control character.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const TEXT_CONTROL = /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/

export interface PluginMailMessage {
  to: string
  subject: string
  text: string
}

// The three fields a plugin may give, or null when one is missing, too long, or could carry a header.
export const pluginMailMessage = (value: unknown): PluginMailMessage | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const { to, subject, text } = value as Record<string, unknown>
  if (typeof to !== 'string' || to.length > MAX_ADDRESS || !ADDRESS.test(to)) return null
  if (typeof subject !== 'string' || subject.trim() === '' || subject.length > MAX_SUBJECT || CONTROL.test(subject))
    return null
  if (typeof text !== 'string' || text.trim() === '' || text.length > MAX_TEXT || TEXT_CONTROL.test(text)) return null
  return { to, subject, text }
}

export interface PluginMailer {
  available: () => boolean
  // The server's address set in Serveur › E-mail, for a link in an e-mail (Hodi's own reset links use it); null
  // without one.
  appUrl: () => string | null
  send: (plugin: { id: string; name: string }, value: unknown) => Promise<void>
}

// No mail server at all: available() is false and every send is refused.
export const NO_MAIL: PluginMailer = {
  available: () => false,
  appUrl: () => null,
  send: async () => {
    throw new Error('mail_unavailable')
  }
}

export const pluginMailer = ({
  store,
  send,
  languageOf = () => 'fr',
  now = Date.now,
  log = console.log
}: {
  store: Pick<MailSettingsStore, 'get'>
  send: SendMail
  // The footer's language: the recipient's, when they have an account.
  languageOf?: (email: string) => Language
  now?: () => number
  log?: (line: string) => void
}): PluginMailer => {
  // The times of each plugin's e-mails of the last hour, and whether its log already says it reached the limit.
  const sent = new Map<string, number[]>()
  const told = new Set<string>()

  return {
    available: () => store.get() !== null,
    appUrl: () => store.get()?.appUrl ?? null,
    send: async (plugin, value) => {
      const settings = store.get()
      if (!settings) throw new Error('mail_unavailable')
      const message = pluginMailMessage(value)
      if (!message) throw new Error('invalid_mail')

      const at = now()
      const recent = (sent.get(plugin.id) ?? []).filter(time => at - time < HOUR_MS)
      if (recent.length >= PLUGIN_MAILS_PER_HOUR) {
        sent.set(plugin.id, recent)
        if (!told.has(plugin.id)) {
          told.add(plugin.id)
          log(`[plugin ${plugin.id}] reached ${PLUGIN_MAILS_PER_HOUR} e-mails in an hour: the next ones are refused`)
        }
        throw new Error('mail_limit')
      }
      told.delete(plugin.id)
      // Counted before it leaves: a send that fails still took its place, so a failing server is not hammered.
      sent.set(plugin.id, [...recent, at])

      const t = textsIn(languageOf(message.to))
      const footer = settings.appUrl
        ? t('mail.plugin.footer', { plugin: plugin.name, address: settings.appUrl })
        : t('mail.plugin.footerNoAddress', { plugin: plugin.name })
      try {
        await send(settings, { to: message.to, subject: message.subject, text: `${message.text}\n\n-- \n${footer}` })
      } catch (error) {
        log(`[plugin ${plugin.id}] e-mail not sent: ${error instanceof Error ? error.message : String(error)}`)
        throw new Error('mail_failed')
      }
    }
  }
}
