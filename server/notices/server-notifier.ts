import type { MailSettings } from '../db/mail-settings-store.ts'
import type { ServerInboxStore } from '../db/server-inbox-store.ts'
import type { ServerNoticeStore } from '../db/server-notice-store.ts'
import type { UserAccount } from '../db/user-account-store.ts'
import { textsIn } from '../i18n.ts'
import { hodiFrame } from '../mail/frame.ts'
import type { SendMail } from '../mail/mailer.ts'
import { type MailBlock, renderMail } from '../mail/template.ts'
import type { AlertPayload, PushTarget, SendPush } from '../news/followed-alerts.ts'
import { LANGUAGES, type Language } from '../../shared/i18n.ts'

// Serveur › Notifications: what happens on the server reaches each of its admins as they chose for its kind, by
// e-mail (in Hodi's template), in push on the devices of their account, both or neither. A failure on one way or one
// admin never keeps the others from being told.

export interface ServerNotice {
  // Who tells it: « Serveur », a plugin's name. The e-mail's small line above its title, before the push's title.
  from: string
  title: string
  // Plain text; its paragraphs apart by an empty line.
  text: string
  // The hash route it opens: « #/server/plugin/village/households ».
  url: string
  // More of the e-mail under its text: the weekly report's tables.
  blocks?: MailBlock[]
  // The push's text, when it is not the e-mail's: the report's main numbers.
  push?: string
}

// A notice the core writes in each admin's language (the weekly report), or one already written (a plugin's).
export type ServerNoticeIn = ServerNotice | ((language: Language) => ServerNotice)

export interface ServerNotifier {
  // How many e-mails and pushes left. important: the key of a request someone waits on (« code-request:12 »): it stays
  // « À traiter » in Serveur › Notifications until handled, and the same one waiting is not told again.
  tell: (
    type: string,
    notice: ServerNoticeIn,
    options?: { important?: string }
  ) => Promise<{ emails: number; pushes: number }>
}

interface NotifierDeps {
  store: ServerNoticeStore
  admins: () => UserAccount[]
  // home: the public site (Serveur › Général), under the card.
  mail: { settings: () => MailSettings | null; send: SendMail; home?: () => string | null }
  push: SendPush
  languageOf: (account: UserAccount) => Language
  // Serveur › Notifications' list: every notice, whatever way each admin chose.
  inbox?: ServerInboxStore
  now?: () => number
  log?: (line: string) => void
}

// The notice in each language, as the list shows it in the admin's.
const textsOf = (written: ServerNoticeIn) =>
  Object.fromEntries(
    LANGUAGES.map(language => {
      const { from, title, text, push } = typeof written === 'function' ? written(language) : written
      return [language, { from, title, text: push ?? text }]
    })
  )

const failure = (error: unknown) => (error instanceof Error ? error.message : String(error))

const sendMail = async (
  notice: ServerNotice,
  { account, language }: { account: UserAccount; language: Language },
  settings: MailSettings,
  deps: NotifierDeps
) => {
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

const payloadOf = (type: string, notice: ServerNotice): AlertPayload => ({
  title: `${notice.from} · ${notice.title}`,
  body: notice.push ?? notice.text.replace(/\n+/g, ' '),
  url: notice.url,
  // One per kind on a device: a newer one replaces it.
  tag: `server:${type}`,
  badge: null
})

// 1 when the e-mail left, 0 when it failed: the others are still told.
const mailOne = async (
  type: string,
  notice: ServerNotice,
  to: { account: UserAccount; language: Language },
  settings: MailSettings,
  deps: NotifierDeps
) => {
  try {
    await sendMail(notice, to, settings, deps)
    return 1
  } catch (error) {
    deps.log?.(`Server notice ${type}: e-mail not sent: ${failure(error)}`)
    return 0
  }
}

// Into Serveur › Notifications' list; false when the same request already waits there.
const record = (deps: NotifierDeps, type: string, written: ServerNoticeIn, important: string | undefined) => {
  if (!deps.inbox) return true
  const url = (typeof written === 'function' ? written('fr') : written).url
  return deps.inbox.add({ type, texts: textsOf(written), url, key: important ?? null }, (deps.now ?? Date.now)())
}

export const serverNotifier = (deps: NotifierDeps): ServerNotifier => ({
  tell: async (type, written, options = {}) => {
    if (!record(deps, type, written, options.important)) return { emails: 0, pushes: 0 }
    const settings = deps.mail.settings()
    let emails = 0
    let pushes = 0
    for (const account of deps.admins()) {
      const choice = deps.store.choice(account.id, type)
      if (!(choice.email && settings) && !choice.push) continue
      const language = deps.languageOf(account)
      const notice = typeof written === 'function' ? written(language) : written
      if (choice.email && settings) emails += await mailOne(type, notice, { account, language }, settings, deps)
      if (choice.push) pushes += await pushTo(deps.store.devices(account.id), payloadOf(type, notice), deps)
    }
    return { emails, pushes }
  }
})
