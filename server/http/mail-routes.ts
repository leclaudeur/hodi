import express from 'express'
import { type MailSettingsStore, type MailState, mailChangesOf, mailDraftOf } from '../db/mail-settings-store.ts'
import type { UserAccountStore } from '../db/user-account-store.ts'
import { textsIn } from '../i18n.ts'
import { hodiFrame } from '../mail/frame.ts'
import { renderMail } from '../mail/template.ts'
import { MailError, type SendMail } from '../mail/mailer.ts'
import type { Language } from '../../shared/i18n.ts'
import { profileIdOf } from './profile-routes.ts'

// Serveur › E-mail, for the server's admin only (requireServerAdmin stands in front): the mail server, and a test
// e-mail to the admin's own address. The password is never sent back, only whether there is one.

// ready: Hodi sends with them, once the server and the sender are both given.
const publicSettings = (state: MailState | null) =>
  state && {
    host: state.host,
    port: state.port,
    security: state.security,
    user: state.user,
    hasPassword: state.password !== null,
    sender: state.sender,
    ready: state.host !== null && state.sender !== null
  }

export const mailRoutes = ({
  mail,
  send,
  accounts,
  languageOf,
  now
}: {
  mail: MailSettingsStore
  send: SendMail
  accounts: UserAccountStore
  languageOf: (profileId: number) => Language
  now: () => number
}) => {
  const router = express.Router()

  router.get('/', (_request, response) => {
    response.json({ mail: publicSettings(mail.state()) })
  })

  router.put('/', (request, response) => {
    const draft = mailDraftOf((request.body ?? {}) as Record<string, unknown>)
    if (!draft) {
      response.status(400).json({ error: 'invalid_request' })
      return
    }
    mail.set(draft, now())
    response.json({ mail: publicSettings(mail.state()) })
  })

  // One row of the page: only the fields given change.
  router.patch('/', (request, response) => {
    const changes = mailChangesOf((request.body ?? {}) as Record<string, unknown>)
    if (!changes) {
      response.status(400).json({ error: 'invalid_request' })
      return
    }
    response.json({ mail: publicSettings(mail.update(changes, now())) })
  })

  // Hodi sends no e-mail any more: « Mot de passe oublié » goes away.
  router.delete('/', (_request, response) => {
    mail.clear()
    response.json({ mail: null })
  })

  // « Envoyer un essai »: one e-mail to the admin's own address, through the saved settings.
  router.post('/test', async (_request, response) => {
    const settings = mail.get()
    // The account signed in, even when it has no profile: a server's admin outside any household tests too.
    const accountId = response.locals.accountId as number | undefined
    const account = accountId === undefined ? accounts.ofProfile(profileIdOf(response)) : accounts.get(accountId)
    if (!settings || !account) {
      response.status(409).json({ error: 'not_configured' })
      return
    }
    const language = languageOf(profileIdOf(response))
    const t = textsIn(language)
    const content = {
      eyebrow: t('mail.test.eyebrow'),
      title: t('mail.test.title'),
      blocks: [{ kind: 'text' as const, text: t('mail.test.text') }]
    }
    try {
      const { html, text } = renderMail(content, hodiFrame(language, settings.appUrl), language)
      await send(settings, { to: account.email, subject: t('mail.test.subject'), text, html })
      response.json({ to: account.email })
    } catch (error) {
      response.status(502).json({ error: error instanceof MailError ? `mail_${error.reason}` : 'mail_unreachable' })
    }
  })

  return router
}
