import { ArrowRight, Inbox } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { InboxItem, SourceReview } from '../../../api.ts'
import { clockTime, numericDate } from '../../../lib/format.ts'
import { inboxKindOf, isWaiting, reviewedSourceOf } from '../../../lib/server-inbox.ts'
import Button from '../../../ui/Button.tsx'
import StatusLine from '../../../ui/StatusLine.tsx'
import EmptyCard from '../../settings/EmptyCard.tsx'
import SectionPage from '../../settings/SectionPage.tsx'
import { textsOf } from './InboxList.tsx'
import styles from './Inbox.module.css'
import SourceReviewPanel from './SourceReviewPanel.tsx'

type Layout = 'desktop' | 'phone'

// « 21.11.2026 · 09:41 ».
const when = (at: number) => `${numericDate(new Date(at).toISOString())} · ${clockTime(at)}`

// What the item asks of the admin: a source to judge here, else the page where it is done.
const ItemAction = ({ item, review }: { item: InboxItem; review: SourceReview | null }) => {
  const { t } = useTranslation()
  if (review) return <SourceReviewPanel key={review.id} review={review} />
  if (inboxKindOf(item) === 'source' || item.url.startsWith('#/server/inbox')) return null
  return (
    <Button icon={ArrowRight} href={item.url}>
      {t(`server.inbox.open.${inboxKindOf(item)}`)}
    </Button>
  )
}

// One item of À traiter: its title and text, who told it and when, then what to do about it.
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
  const handled = item.important && !isWaiting(item)
  return (
    <SectionPage title={texts.title} intro={layout === 'desktop' ? texts.text : undefined} layout={layout}>
      {layout === 'phone' && (
        <div className={styles.phoneHead}>
          <h2 className={styles.phoneTitle}>{texts.title}</h2>
          <p className={styles.phoneText}>{texts.text}</p>
        </div>
      )}
      <span className={styles.meta}>{`${texts.from} · ${when(item.createdAt)}`}</span>
      {handled && item.handledAt !== null && (
        <StatusLine tone="success">{t('server.inbox.handled', { date: when(item.handledAt) })}</StatusLine>
      )}
      {isWaiting(item) || !item.important ? <ItemAction item={item} review={review} /> : null}
    </SectionPage>
  )
}

export default InboxItemPage
