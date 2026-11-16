import type { MailSettings } from '../db/mail-settings-store.ts'
import type { ServerNoticeStore } from '../db/server-notice-store.ts'
import type { UserAccount } from '../db/user-account-store.ts'
import { textsIn } from '../i18n.ts'
import { hodiFrame } from '../mail/frame.ts'
import type { SendMail } from '../mail/mailer.ts'
import { type MailBlock, renderMail } from '../mail/template.ts'
import type { AlertPayload, PushTarget, SendPush } from '../news/followed-alerts.ts'
import type { Language } from '../../shared/i18n.ts'

// Serveur › Notifications: what happens on the server reaches each of its admins as they chose for its kind, by
// e-mail (in Hodi's template), in push on the devices of their account, both or neither. A failure on one way or one
// admin never keeps the others from being told.

export interface ServerNotice {
  // The kind's id: « core:weekly-report », « plugin:village:household ».
  type: string
  // Who tells it: « Serveur », a plugin's name. The e-mail's small line above its title, before the push's title.
  from: string
  title: string
  // Plain text; its paragraphs apart by an empty line.
  text: string
  // The hash route it opens: « #/server/plugin/village/households ».
  url: string
  // More of the e-mail under its text: the weekly report's tables.
  blocks?: MailBlock[]
}

export interface ServerNotifier {
  // How many e-mails and pushes left.
  tell: (notice: ServerNotice) => Promise<{ emails: number; pushes: number }>
}

interface NotifierDeps {
  store: ServerNoticeStore
  admins: () => UserAccount[]
  // home: the public site (Serveur › Général), under the card.
  mail: { settings: () => MailSettings | null; send: SendMail; home?: () => string | null }
  push: SendPush
  languageOf: (account: UserAccount) => Language
  log?: (line: string) => void
}

const failure = (error: unknown) => (error instanceof Error ? error.message : String(error))

const sendMail = async (notice: ServerNotice, account: UserAccount, settings: MailSettings, deps: NotifierDeps) => {
  const language = deps.languageOf(account)
  const t = textsIn(language)
  const blocks: MailBlock[] = [
    ...notice.text.split(/\n{2,}/).map(text => ({ kind: 'text' as const, text })),
    ...(notice.blocks ?? []),
    ...(settings.appUrl
      ? [{ kind: 'action' as const, label: t('mail.serverNotice.open'), url: `${settings.appUrl}/${notice.url}` }]
      : []),
    { kind: 'note', text: t('mail.serverNotice.note') }
  ]
  const { html, text } = renderMail(
    { eyebrow: notice.from, title: notice.title, blocks },
    hodiFrame(language, { appUrl: settings.appUrl, home: deps.mail.home?.() ?? null }),
    language
  )
  await deps.mail.send(settings, { to: account.email, subject: `${notice.from} · ${notice.title}`, text, html })
}

const pushTo = async (targets: PushTarget[], payload: AlertPayload, deps: NotifierDeps) => {
  let sent = 0
  for (const target of targets) {
    try {
      await deps.push(target, payload)
      sent++
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode
      // The browser dropped the subscription: the device is forgotten.
      if (status === 404 || status === 410) deps.store.removeDevice(target.endpoint)
      else deps.log?.(`Server notice: push failed (${status ?? 'network'})`)
    }
  }
  return sent
}

export const serverNotifier = (deps: NotifierDeps): ServerNotifier => ({
  tell: async notice => {
    const settings = deps.mail.settings()
    const payload: AlertPayload = {
      title: `${notice.from} · ${notice.title}`,
      body: notice.text.replace(/\n+/g, ' '),
      url: notice.url,
      // One per kind on a device: a newer one replaces it.
      tag: `server:${notice.type}`,
      badge: null
    }
    let emails = 0
    let pushes = 0
    for (const account of deps.admins()) {
      const choice = deps.store.choice(account.id, notice.type)
      if (choice.email && settings) {
        try {
          await sendMail(notice, account, settings, deps)
          emails++
        } catch (error) {
          deps.log?.(`Server notice ${notice.type}: e-mail not sent: ${failure(error)}`)
        }
      }
      if (choice.push) pushes += await pushTo(deps.store.devices(account.id), payload, deps)
    }
    return { emails, pushes }
  }
})
