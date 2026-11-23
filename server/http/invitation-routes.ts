import express from 'express'
import { LoginThrottle } from '../auth/login-throttle.ts'
import { currentHouseholdId } from '../db/household-scope.ts'
import type { MailSettingsStore } from '../db/mail-settings-store.ts'
import { codeForPeople, type Invite, type SignInCodeStore } from '../db/sign-in-code-store.ts'
import { cleanEmail } from '../db/user-account-store.ts'
import { textsIn } from '../i18n.ts'
import { hodiFrame } from '../mail/frame.ts'
import type { SendMail } from '../mail/mailer.ts'
import { renderMail } from '../mail/template.ts'
import type { Language } from '../../shared/i18n.ts'
import { isParentOf, profileIdOf } from './profile-routes.ts'
import { CONFIG } from '../fixed-config.ts'

// Réglages › Profils › Personnes invitées: the invitations an adult of the household made and nobody used yet, each
// under the name it was given. With Serveur › E-mail set, its code also goes by e-mail.

export interface InvitationMail {
  store: MailSettingsStore
  send: SendMail
  // The inviter's language: the e-mail goes out in it.
  languageOf: (profileId: number) => Language
  // Who invites, named in the e-mail; and the household it is.
  inviterOf: (profileId: number) => { name: string; household: string }
  home?: () => string | null
  log?: (line: string) => void
}

export interface InvitationOptions {
  codes: SignInCodeStore
  now: () => number
  mail?: InvitationMail
}

const MAX_INVITE_NAME = CONFIG.invitations.nameMaxLength

// The invitation's name and address as typed: null when the name is missing or too long, or the address is not one.
export const inviteOf = (body: unknown): Invite | null | 'invalid' => {
  const { name, email } = (body ?? {}) as { name?: unknown; email?: unknown }
  if (name === undefined) return null
  const trimmed = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : ''
  if (!trimmed || trimmed.length > MAX_INVITE_NAME) return 'invalid'
  if (email === undefined || email === null || email === '') return { name: trimmed, email: null }
  const clean = cleanEmail(email)
  return clean ? { name: trimmed, email: clean } : 'invalid'
}

// Whether the server can send the code: Serveur › E-mail set, with the app's address for the link.
const canMail = (mail: InvitationMail | undefined) => mail !== undefined && mail.store.canSendLinks()

// Each e-mail goes to any address a person typed: a household sends a few a day at most, and the whole server a few
// hundred, so the server's address never becomes a way to write to strangers. Past them the code still shows, to give
// by hand.
export const INVITATION_MAILS_PER_DAY = CONFIG.invitations.mailsPerDay
const SERVER_INVITATION_MAILS_PER_DAY = CONFIG.invitations.serverMailsPerDay
const DAY_MS = 24 * 60 * 60 * 1000
const budgets = new WeakMap<InvitationMail, LoginThrottle>()

const spendMail = (mail: InvitationMail, now: number) => {
  let budget = budgets.get(mail)
  if (!budget) {
    budget = new LoginThrottle(INVITATION_MAILS_PER_DAY, DAY_MS, SERVER_INVITATION_MAILS_PER_DAY)
    budgets.set(mail, budget)
  }
  const household = `household:${currentHouseholdId()}`
  if (!budget.check(now, household).allowed) return false
  budget.recordFailure(now, household)
  return true
}

// The code by e-mail, after the answer: a failure is logged, the code still shows in the list. false when nothing
// was sent.
export const mailInvitation = (
  mail: InvitationMail | undefined,
  { to, code, inviter, now }: { to: string; code: string; inviter: number; now: number }
) => {
  const settings = mail?.store.get()
  const appUrl = mail?.store.appUrl()
  if (!mail || !settings || !appUrl || !spendMail(mail, now)) return false
  const language = mail.languageOf(inviter)
  const t = textsIn(language)
  const { name, household } = mail.inviterOf(inviter)
  const content = {
    eyebrow: household,
    title: t('mail.invite.title', { household }),
    blocks: [
      { kind: 'text' as const, text: t('mail.invite.text', { name, household }) },
      { kind: 'text' as const, text: t('mail.invite.code', { code: codeForPeople(code) }) },
      { kind: 'action' as const, label: t('mail.invite.button'), url: `${appUrl}/#/code/${code}` },
      { kind: 'note' as const, text: t('mail.invite.note') }
    ]
  }
  const { html, text } = renderMail(content, hodiFrame(language, { appUrl, home: mail.home?.() ?? null }), language)
  mail
    .send(settings, { to, subject: t('mail.invite.subject', { name }), text, html })
    .catch((error: unknown) => (mail.log ?? console.error)(`Invitation e-mail failed: ${String(error)}`))
  return true
}

export const invitationRoutes = ({ codes, now, mail }: InvitationOptions) => {
  const router = express.Router()
  router.use((_request, response, next) => {
    if (response.locals.profileChosen !== true || !isParentOf(response))
      response.status(403).json({ error: 'adults_only' })
    else next()
  })

  // The list, and whether a code can go by e-mail (the invite dialog asks an address then).
  router.get('/', (_request, response) => {
    response.set('Cache-Control', 'no-store')
    response.json({ mail: canMail(mail), invitations: codes.invitations(now()) })
  })

  router.delete('/:id', (request, response) => {
    if (!codes.cancelInvitation(Number(request.params.id))) response.status(404).json({ error: 'not_found' })
    else response.status(204).end()
  })

  // « Voir le code » or « Renvoyer »: a new code for the same invitation, sent again when it has an address.
  router.post('/:id/code', (request, response) => {
    const inviter = profileIdOf(response)
    const renewed = codes.renewInvitation(Number(request.params.id), inviter, now())
    if (!renewed) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    const email = renewed.invite?.email ?? null
    const sent = email !== null && mailInvitation(mail, { to: email, code: renewed.code, inviter, now: now() })
    response.status(201).json({ code: renewed.code, expiresAt: renewed.expiresAt, sent })
  })

  return router
}
