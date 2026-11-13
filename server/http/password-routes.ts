import express from 'express'
import { LoginThrottle } from '../auth/login-throttle.ts'
import { hashPassword } from '../auth/password.ts'
import type { MailSettingsStore } from '../db/mail-settings-store.ts'
import { type PasswordResetStore, isResetToken } from '../db/password-reset-store.ts'
import { type UserAccount, type UserAccountStore, cleanEmail } from '../db/user-account-store.ts'
import { textsIn } from '../i18n.ts'
import type { SendMail } from '../mail/mailer.ts'
import type { Language } from '../../shared/i18n.ts'
import { clientAddressOf } from './client-address.ts'
import { isPassword } from './household-input.ts'
import { ANYONE_IN, type CheckSignIn, refuseSignIn } from './sign-in-check.ts'

// « Mot de passe oublié », before the session check: a link by e-mail, then a new password. It exists only once
// Serveur › E-mail is set with Hodi's address. The answer is the same whether an account has the e-mail or not, and
// the e-mail leaves after it, so neither its words nor its time say who has an account.

interface PasswordRoutesOptions {
  mail: MailSettingsStore
  send: SendMail
  resets: PasswordResetStore
  accounts: UserAccountStore
  // The language of the account's profile, else the household's.
  languageOf: (account: UserAccount) => Language
  // The new password, every device of the account signed out, and this one signed in: its cookies (none when the
  // account asks for its app's code at sign-in).
  signIn: (account: UserAccount, passwordHash: string, request: express.Request) => string[]
  // The plugins' say on this account signing in, asked before the link is used up or the password changes.
  checkSignIn?: CheckSignIn
  now: () => number
  log?: (message: string) => void
  throttle?: LoginThrottle
}

// The defaults filled in.
type ResolvedOptions = PasswordRoutesOptions & Required<Pick<PasswordRoutesOptions, 'checkSignIn' | 'log' | 'throttle'>>

export const passwordRoutes = ({
  checkSignIn = ANYONE_IN,
  log = console.error,
  // Every request for a link counts: ten from a device in a quarter of an hour, a hundred from all of them.
  throttle = new LoginThrottle(),
  ...options
}: PasswordRoutesOptions) => {
  const router = express.Router()
  const resolved = { ...options, checkSignIn, log, throttle }
  mountForgotRoute(router, resolved)
  mountResetRoutes(router, resolved)
  return router
}

const mountForgotRoute = (
  router: express.Router,
  { mail, send, resets, accounts, languageOf, now, log, throttle }: ResolvedOptions
) => {
  const throttled = (request: express.Request, response: express.Response) => {
    const client = clientAddressOf(request)
    const decision = throttle.check(now(), client)
    if (!decision.allowed) {
      response.set('Retry-After', String(decision.retryAfterSeconds))
      response.status(429).json({ error: 'too_many_attempts', retryAfterSeconds: decision.retryAfterSeconds })
      return true
    }
    throttle.recordFailure(now(), client)
    return false
  }

  router.post('/forgot', (request, response) => {
    const settings = mail.get()
    if (!settings?.appUrl) {
      response.status(404).json({ error: 'mail_off' })
      return
    }
    const email = cleanEmail(request.body?.email)
    if (!email) {
      response.status(400).json({ error: 'invalid_request' })
      return
    }
    if (throttled(request, response)) return
    response.status(202).json({})

    const account = accounts.byEmail(email)
    const token = account ? resets.create(account.id, now()) : null
    if (!account || !token) return
    const t = textsIn(languageOf(account))
    const link = `${settings.appUrl}/#/reset/${token}`
    send(settings, {
      to: account.email,
      subject: t('mail.reset.subject'),
      text: t('mail.reset.text', { email: account.email, link })
    }).catch((error: unknown) => log(`Password reset e-mail failed: ${String(error)}`))
  })
}

const mountResetRoutes = (router: express.Router, { resets, accounts, signIn, checkSignIn, now }: ResolvedOptions) => {
  // « Nouveau mot de passe »: whose account the link is for, while it works.
  router.post('/check', (request, response) => {
    const token: unknown = request.body?.token
    const userId = isResetToken(token) ? resets.peek(token, now()) : null
    const account = userId === null ? null : accounts.get(userId)
    if (!account) {
      response.status(404).json({ error: 'invalid_link' })
      return
    }
    response.json({ email: account.email })
  })

  router.post('/reset', async (request, response) => {
    const token: unknown = request.body?.token
    const password: unknown = request.body?.password
    if (!isResetToken(token) || !isPassword(password)) {
      response.status(400).json({ error: 'invalid_request' })
      return
    }
    const peeked = resets.peek(token, now())
    const owner = peeked === null ? null : accounts.get(peeked)
    const refusal = owner ? await checkSignIn(owner) : null
    if (refusal) {
      refuseSignIn(response, refusal)
      return
    }
    const passwordHash = await hashPassword(password)
    // From here on nothing waits: no other request runs between the take and the writes.
    const userId = resets.take(token, now())
    const account = userId === null ? null : accounts.get(userId)
    if (!account) {
      response.status(404).json({ error: 'invalid_link' })
      return
    }
    const cookies = signIn(account, passwordHash, request)
    // None with « Validation en deux étapes » on: the device signs in on Connexion, with the app's code.
    if (cookies.length === 0) {
      response.json({ signIn: false })
      return
    }
    response.set('Set-Cookie', cookies)
    response.status(204).end()
  })
}
