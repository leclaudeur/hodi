import { textsIn } from '../i18n.ts'
import type { Language } from '../../shared/i18n.ts'
import type { ServerNotice } from './server-notifier.ts'

// A source someone reported: it waits in À traiter for the admin to keep or take it out of the catalogue.
export const SOURCE_REPORT = 'core:source-report'

export const sourceReportKey = (sourceId: string) => `source-report:${sourceId}`

export const sourceReportNotice = (source: { id: string; name: string }, language: Language): ServerNotice => {
  const t = textsIn(language)
  return {
    from: t('mail.sourceReport.eyebrow'),
    title: t('mail.sourceReport.title', { name: source.name }),
    text: t('mail.sourceReport.text', { name: source.name }),
    url: `#/server/inbox/report-${source.id}`
  }
}
