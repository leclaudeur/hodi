import express from 'express'
import { LoginThrottle } from '../auth/login-throttle.ts'
import { hashPassword } from '../auth/password.ts'
import type { MailSettingsStore } from '../db/mail-settings-store.ts'
import type { PasswordResetStore } from '../db/password-reset-store.ts'
import { codeForPeople, signInCodeOf } from '../db/sign-in-code-store.ts'
import { type UserAccount, type UserAccountStore, cleanEmail } from '../db/user-account-store.ts'
import { textsIn } from '../i18n.ts'
import { hodiFrame } from '../mail/frame.ts'
import { renderMail } from '../mail/template.ts'
import type { SendMail } from '../mail/mailer.ts'
import type { Language } from '../../shared/i18n.ts'
import { clientAddressOf } from './client-address.ts'
import { isPassword } from './household-input.ts'
import { ANYONE_IN, type CheckSignIn, refuseSignIn } from './sign-in-check.ts'

// « Mot de passe oublié », before the session check: a code by e-mail, then a new password. It exists only once
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
  // Without e-mail: the server's admin is asked for a code for this account (Serveur › Notifications).
  askAdmin?: (account: UserAccount) => void
  // The plugins' say on this account signing in, asked before the link is used up or the password changes.
  checkSignIn?: CheckSignIn
  now: () => number
  // The public site (Serveur › Général), under the card.
  home?: () => string | null
  log?: (message: string) => void
  throttle?: LoginThrottle
}

// The defaults filled in.
type ResolvedOptions = PasswordRoutesOptions & Required<Pick<PasswordRoutesOptions, 'checkSignIn' | 'log' | 'throttle'>>

export const passwordRoutes = ({
  checkSignIn = ANYONE_IN,
  log = console.error,
  // Every request for a code and every wrong code counts: ten from a device in a quarter of an hour, a hundred from
  // all of them.
  throttle = new LoginThrottle(),
  ...options
}: PasswordRoutesOptions) => {
  const router = express.Router()
  const resolved = { ...options, checkSignIn, log, throttle }
  mountForgotRoute(router, resolved)
  mountAskRoute(router, resolved)
  mountResetRoutes(router, resolved)
  return router
}

// A request for a code, or a wrong code: refused (true) while the device or the server has had too many.
const throttledBy =
  ({ throttle, now }: ResolvedOptions) =>
  (request: express.Request, response: express.Response) => {
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

const mountForgotRoute = (router: express.Router, options: ResolvedOptions) => {
  const { mail, send, resets, accounts, languageOf, home, now, log } = options
  const throttled = throttledBy(options)
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
    const code = account ? resets.create(account.id, now()) : null
    if (!account || !code) return
    const language = languageOf(account)
    const t = textsIn(language)
    const link = `${settings.appUrl}/#/reset/${code}`
    const content = {
      eyebrow: t('mail.reset.eyebrow'),
      title: t('mail.reset.title'),
      blocks: [
        { kind: 'text' as const, text: t('mail.reset.text', { email: account.email }) },
        { kind: 'code' as const, code: codeForPeople(code) },
        { kind: 'action' as const, label: t('mail.reset.button'), url: link },
        { kind: 'note' as const, text: t('mail.reset.note') }
      ]
    }
    const { html, text } = renderMail(
      content,
      hodiFrame(language, { appUrl: settings.appUrl, home: home?.() ?? null }),
      language
    )
    send(settings, { to: account.email, subject: t('mail.reset.subject'), text, html }).catch((error: unknown) =>
      log(`Password reset e-mail failed: ${String(error)}`)
    )
  })
}

// « Demander un code », on a server that sends no e-mail. The answer is the same whether an account has the address or
// not; the admin is told only of an account that reads in a household, where a code can be made for it.
const mountAskRoute = (router: express.Router, options: ResolvedOptions) => {
  const { mail, accounts, askAdmin } = options
  const throttled = throttledBy(options)
  router.post('/ask', (request, response) => {
    if (!askAdmin || mail.get()?.appUrl) {
      response.status(404).json({ error: 'mail_on' })
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
    if (account) askAdmin(account)
  })
}

const mountResetRoutes = (router: express.Router, options: ResolvedOptions) => {
  const { resets, accounts, signIn, checkSignIn, now, throttle } = options
  const throttled = throttledBy(options)
  // « Entre le code »: whose account the code is for, while it works. Only a wrong code counts against the device.
  router.post('/check', (request, response) => {
    const code = signInCodeOf(request.body?.code)
    const decision = throttle.check(now(), clientAddressOf(request))
    const userId = code && decision.allowed ? resets.peek(code, now()) : null
    const account = userId === null ? null : accounts.get(userId)
    if (account) response.json({ email: account.email })
    else if (!throttled(request, response)) response.status(404).json({ error: 'invalid_code' })
  })

  router.post('/reset', async (request, response) => {
    const token = signInCodeOf(request.body?.code)
    const password: unknown = request.body?.password
    if (!token || !isPassword(password)) {
      response.status(400).json({ error: 'invalid_request' })
      return
    }
    // A wrong code counts as at « Entre le code », before the password is hashed: guessing here costs the server
    // nothing and gets no more tries.
    const decision = throttle.check(now(), clientAddressOf(request))
    const peeked = decision.allowed ? resets.peek(token, now()) : null
    const owner = peeked === null ? null : accounts.get(peeked)
    if (!owner) {
      if (!throttled(request, response)) response.status(404).json({ error: 'invalid_code' })
      return
    }
    const refusal = await checkSignIn(owner)
    if (refusal) {
      refuseSignIn(response, refusal)
      return
    }
    const passwordHash = await hashPassword(password)
    // From here on nothing waits: no other request runs between the take and the writes.
    const userId = resets.take(token, now())
    const account = userId === null ? null : accounts.get(userId)
    if (!account) {
      response.status(404).json({ error: 'invalid_code' })
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
