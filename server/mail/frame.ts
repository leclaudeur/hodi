import { textsIn } from '../i18n.ts'
import type { Language } from '../../shared/i18n.ts'
import type { MailFrame } from './template.ts'

// What Hodi's own e-mails say around their card, in the recipient's language.
export const hodiFrame = (language: Language, address: string | null): MailFrame => {
  const t = textsIn(language)
  return { linkFallback: t('mail.linkFallback'), sentBy: t('mail.sentBy'), address }
}
