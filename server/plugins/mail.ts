import type { MailSettingsStore } from '../db/mail-settings-store.ts'
import { hodiFrame } from '../mail/frame.ts'
import type { SendMail } from '../mail/mailer.ts'
import { type MailBlock, renderMail } from '../mail/template.ts'
import { type PluginMailMessage, pluginMailMessage } from './mail-message.ts'
import type { Language } from '../../shared/i18n.ts'
import { HOUR_MS } from '../../shared/time.ts'
import { CONFIG } from '../fixed-config.ts'

// ctx.mail: a plugin's e-mails, sent through Serveur › E-mail. The core builds every message itself, in its own
// template, from a few checked fields, so nothing the plugin adds (a second recipient, a sender, HTML, an attachment
// that names a file on the server) reaches nodemailer, and it counts each plugin's e-mails here, in the main thread,
// where a restart of the plugin's thread cannot reset them.

export { pluginMailMessage }

// The plugin's fields as the template's blocks, always in the same order: its paragraphs, the code and its caption,
// the button, the note.
const blocksOf = (message: PluginMailMessage): MailBlock[] => [
  ...message.text.split(/\n{2,}/).map(text => ({ kind: 'text' as const, text })),
  ...(message.code ? [{ kind: 'code' as const, code: message.code }] : []),
  ...(message.caption ? [{ kind: 'caption' as const, text: message.caption }] : []),
  ...(message.action ? [{ kind: 'action' as const, ...message.action }] : []),
  ...(message.note ? [{ kind: 'note' as const, text: message.note }] : [])
]

// How many e-mails one plugin may send in an hour.
export const PLUGIN_MAILS_PER_HOUR = CONFIG.pluginMail.perHour

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
  home = () => null,
  now = Date.now,
  log = console.log
}: {
  store: Pick<MailSettingsStore, 'get'>
  send: SendMail
  // The footer's language, when the plugin does not say: the recipient's, when they have an account.
  languageOf?: (email: string) => Language
  // The public site (Serveur › Général), under the card; Hodi's address without one.
  home?: () => string | null
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

      const language = message.language ?? languageOf(message.to)
      // Hodi's e-mail, plugin or not: the people who get it never need to know which part of Hodi sent it.
      const { html, text } = renderMail(
        {
          ...(message.eyebrow ? { eyebrow: message.eyebrow } : {}),
          title: message.title ?? message.subject,
          blocks: blocksOf(message)
        },
        hodiFrame(language, { appUrl: settings.appUrl, home: home() }),
        language
      )
      try {
        await send(settings, { to: message.to, subject: message.subject, text, html })
      } catch (error) {
        log(`[plugin ${plugin.id}] e-mail not sent: ${error instanceof Error ? error.message : String(error)}`)
        throw new Error('mail_failed')
      }
    }
  }
}
