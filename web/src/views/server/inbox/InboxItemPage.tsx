import { Inbox } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { InboxItem, SourceReportView, SourceReview } from '../../../api.ts'
import { isWaiting, reportedSourceOf, reviewedSourceOf } from '../../../lib/server-inbox.ts'
import StatusLine from '../../../ui/StatusLine.tsx'
import EmptyCard from '../../settings/EmptyCard.tsx'
import SectionPage from '../../settings/SectionPage.tsx'
import { textsOf, whenOf } from './InboxList.tsx'
import styles from './Inbox.module.css'
import SourceReportPanel from './SourceReportPanel.tsx'
import SourceReviewPanel from './SourceReviewPanel.tsx'

type Layout = 'desktop' | 'phone'

// One request of À traiter opened here: its title and text, who told it and when, then a source to judge or reported.
const InboxItemPage = ({
  item,
  reviews,
  reports,
  layout
}: {
  item: InboxItem | null
  reviews: SourceReview[]
  reports: SourceReportView[]
  layout: Layout
}) => {
  const { t, i18n } = useTranslation()
  const texts = item && textsOf(item, i18n.language)
  if (!item || !texts)
    return (
      <SectionPage title={t('server.titles.inbox')} layout={layout}>
        <EmptyCard icon={<Inbox size={20} />} title={t('server.inbox.noneTitle')} hint={t('server.inbox.noneHint')} />
      </SectionPage>
    )
  const sourceId = reviewedSourceOf(item)
  const review = reviews.find(candidate => candidate.id === sourceId) ?? null
  const reportedId = reportedSourceOf(item)
  const report = reports.find(candidate => candidate.id === reportedId) ?? null
  return (
    <SectionPage title={texts.title} intro={layout === 'desktop' ? texts.text : undefined} layout={layout}>
      {layout === 'phone' && (
        <div className={styles.phoneHead}>
          <h2 className={styles.phoneTitle}>{texts.title}</h2>
          <p className={styles.phoneText}>{texts.text}</p>
        </div>
      )}
      <span className={styles.meta}>{`${texts.from} · ${whenOf(item.createdAt)}`}</span>
      {item.handledAt !== null && (
        <StatusLine tone="success">{t('server.inbox.handled', { date: whenOf(item.handledAt) })}</StatusLine>
      )}
      {isWaiting(item) && review && <SourceReviewPanel key={review.id} review={review} />}
      {isWaiting(item) && report && <SourceReportPanel key={report.id} report={report} />}
    </SectionPage>
  )
}

export default InboxItemPage
