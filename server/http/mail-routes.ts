import express from 'express'
import { type MailSettings, type MailSettingsStore, mailDraftOf } from '../db/mail-settings-store.ts'
import type { UserAccountStore } from '../db/user-account-store.ts'
import { textsIn } from '../i18n.ts'
import { MailError, type SendMail } from '../mail/mailer.ts'
import type { Language } from '../../shared/i18n.ts'
import { profileIdOf } from './profile-routes.ts'

// Serveur › E-mail, for the server's admin only (requireServerAdmin stands in front): the mail server, and a test
// e-mail to the admin's own address. The password is never sent back, only whether there is one.

const publicSettings = (settings: MailSettings | null) =>
  settings && {
    host: settings.host,
    port: settings.port,
    security: settings.security,
    user: settings.user,
    hasPassword: settings.password !== null,
    sender: settings.sender,
    appUrl: settings.appUrl
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
    response.json({ mail: publicSettings(mail.get()) })
  })

  router.put('/', (request, response) => {
    const draft = mailDraftOf((request.body ?? {}) as Record<string, unknown>)
    if (!draft) {
      response.status(400).json({ error: 'invalid_request' })
      return
    }
    response.json({ mail: publicSettings(mail.set(draft, now())) })
  })

  // Hodi sends no e-mail any more: « Mot de passe oublié » goes away.
  router.delete('/', (_request, response) => {
    mail.clear()
    response.json({ mail: null })
  })

  // « Envoyer un essai »: one e-mail to the admin's own address, through the saved settings.
  router.post('/test', async (_request, response) => {
    const settings = mail.get()
    const account = accounts.ofProfile(profileIdOf(response))
    if (!settings || !account) {
      response.status(409).json({ error: 'not_configured' })
      return
    }
    const t = textsIn(languageOf(profileIdOf(response)))
    try {
      await send(settings, { to: account.email, subject: t('mail.test.subject'), text: t('mail.test.text') })
      response.json({ to: account.email })
    } catch (error) {
      response.status(502).json({ error: error instanceof MailError ? `mail_${error.reason}` : 'mail_unreachable' })
    }
  })

  return router
}
