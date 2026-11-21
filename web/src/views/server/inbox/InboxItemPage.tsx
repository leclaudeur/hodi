import { Inbox } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { InboxItem, SourceReview } from '../../../api.ts'
import { isWaiting, reviewedSourceOf } from '../../../lib/server-inbox.ts'
import StatusLine from '../../../ui/StatusLine.tsx'
import EmptyCard from '../../settings/EmptyCard.tsx'
import SectionPage from '../../settings/SectionPage.tsx'
import { textsOf, whenOf } from './InboxList.tsx'
import styles from './Inbox.module.css'
import SourceReviewPanel from './SourceReviewPanel.tsx'

type Layout = 'desktop' | 'phone'

// One request of À traiter opened here: its title and text, who told it and when, then a source to judge.
const InboxItemPage = ({
  item,
  reviews,
  layout
}: {
  item: InboxItem | null
  reviews: SourceReview[]
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
    </SectionPage>
  )
}

export default InboxItemPage
