import { textsIn } from '../i18n.ts'
import type { Language } from '../../shared/i18n.ts'
import type { ServerNotice } from './server-notifier.ts'

// A source added while the server validates them: it waits in À traiter for the admin to accept or refuse it.
export const SOURCE_REVIEW = 'core:source-review'

export const sourceReviewKey = (sourceId: string) => `source-review:${sourceId}`

export const sourceReviewNotice = (source: { id: string; name: string }, language: Language): ServerNotice => {
  const t = textsIn(language)
  return {
    from: t('mail.sourceReview.eyebrow'),
    title: t('mail.sourceReview.title', { name: source.name }),
    text: t('mail.sourceReview.text', { name: source.name }),
    url: `#/server/inbox/source-${source.id}`
  }
}
