import { textsIn } from '../i18n.ts'
import type { Language } from '../../shared/i18n.ts'
import type { MailFrame } from './template.ts'

// What every e-mail says around its card, in the recipient's language, plugins' included: always « Envoyé par
// Hodi », and the public site's address when the server has one, so that people know where they signed up.
export const hodiFrame = (
  language: Language,
  { appUrl, home }: { appUrl: string | null; home?: string | null }
): MailFrame => {
  const t = textsIn(language)
  return {
    linkFallback: t('mail.linkFallback'),
    sentBy: t('mail.sentBy'),
    logo: appUrl,
    address: home ? home.replace(/\/+$/, '') : appUrl
  }
}
