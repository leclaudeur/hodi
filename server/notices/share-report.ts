import { textsIn } from '../i18n.ts'
import type { Language } from '../../shared/i18n.ts'
import type { ServerNotice } from './server-notifier.ts'

// A share someone reported: it waits in À traiter, with its sender, for the admin to ignore it or act on the account.
export const SHARE_REPORT = 'core:share-report'

export const shareReportKey = (id: number) => `share-report:${id}`

// Who sent it stays out of the notice: an e-mail or a push is read anywhere.
export const shareReportNotice = (id: number, language: Language): ServerNotice => {
  const t = textsIn(language)
  return {
    from: t('mail.shareReport.eyebrow'),
    title: t('mail.shareReport.title'),
    text: t('mail.shareReport.text'),
    url: `#/server/inbox/share-${id}`
  }
}
