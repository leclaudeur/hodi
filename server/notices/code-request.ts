import type { UserAccount } from '../db/user-account-store.ts'
import { textsIn } from '../i18n.ts'
import type { Language } from '../../shared/i18n.ts'
import type { ServerNotice } from './server-notifier.ts'

// « Mot de passe oublié » on a server without e-mail: the person asks, and the server's admin makes them a code in
// Serveur › Comptes. It waits there, « À traiter », until a code is made for that account.
export const CODE_REQUEST = 'core:code-request'

export const codeRequestKey = (accountId: number) => `code-request:${accountId}`

export const codeRequestNotice = (account: UserAccount, name: string, language: Language): ServerNotice => {
  const t = textsIn(language)
  return {
    from: t('mail.codeRequest.eyebrow'),
    title: t('mail.codeRequest.title', { name }),
    text: t('mail.codeRequest.text', { name, email: account.email }),
    url: `#/server/accounts/${account.id}`
  }
}
