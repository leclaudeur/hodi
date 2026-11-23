import type { UserAccount } from '../db/user-account-store.ts'
import { textsIn } from '../i18n.ts'
import type { Language } from '../../shared/i18n.ts'
import type { ServerNotice } from './server-notifier.ts'
import { CONFIG } from '../fixed-config.ts'

// « Mot de passe oublié » on a server without e-mail: the person asks, and the server's admin makes them a code in
// Serveur › Comptes. It waits there, « À traiter », until a code is made for that account.
export const CODE_REQUEST = 'core:code-request'

export const codeRequestKey = (accountId: number) => `code-request:${accountId}`

// A request older than this makes no code: asked again, it starts over. The admin cannot keep an old one to use later.
export const CODE_REQUEST_TTL_MS = CONFIG.codes.requestKept

// When a request still in time was made, or null.
export const freshRequest = (askedAt: number | null, now: number) =>
  askedAt !== null && now - askedAt <= CODE_REQUEST_TTL_MS ? askedAt : null

export const codeRequestNotice = (account: UserAccount, name: string, language: Language): ServerNotice => {
  const t = textsIn(language)
  return {
    from: t('mail.codeRequest.eyebrow'),
    title: t('mail.codeRequest.title', { name }),
    text: t('mail.codeRequest.text', { name, email: account.email }),
    url: `#/server/accounts/${account.id}`
  }
}
