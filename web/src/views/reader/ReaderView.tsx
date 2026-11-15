import { ExternalLink } from 'lucide-react'
import type { CSSProperties, RefObject } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import type { FeedItem, RelatedItem } from '../../api.ts'
import { numericDate } from '../../lib/format.ts'
import type { ListedArticle } from '../../lib/reading-list.ts'
import { useTextSize } from '../../lib/text-size.ts'
import Chip from '../../ui/Chip.tsx'
import LanguageChip from '../../ui/LanguageChip.tsx'
import ReadingTime from '../../ui/ReadingTime.tsx'
import SourceAvatar from '../../ui/SourceAvatar.tsx'
import TopicCapsule from '../../ui/TopicCapsule.tsx'
import ReaderActions from '../../plugins/ReaderActions.tsx'
import QuestionsCard from './QuestionsCard.tsx'
import styles from './Reader.module.css'
import { AlsoCovered, ExternalNotice, type Layout, NextArticle } from './ReaderParts.tsx'
import { ShareNote, ShareReply } from './ShareNote.tsx'
import SummaryCard from './SummaryCard.tsx'

// "24.10.2026 · 18:42", the date of an article read on its site.
const dateAndTime = (iso: string | null) => {
  const date = numericDate(iso)
  if (!iso || !date) return null
  const at = new Date(iso)
  return `${date} · ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

interface HeaderProps {
  item: FeedItem
  topic: { id: string; label: string } | null
  // Hodi shows its text, rather than sending to its site.
  readable: boolean
  isPhone: boolean
  byline: string | null
  readingMinutes: number | null
  titleRef: RefObject<HTMLHeadingElement | null>
}

// The topic, the title, who wrote it, when, and how long it takes to read.
export const ReaderHeader = ({ item, topic, readable, isPhone, byline, readingMinutes, titleRef }: HeaderProps) => {
  const { t } = useTranslation()
  return (
    <header className={`${styles.header} appear`}>
      {topic && <TopicCapsule topicId={topic.id} label={topic.label} />}
      <h1 ref={titleRef} className={styles.title}>
        {item.title}
      </h1>
      {(readable || isPhone) && (
        <p className={styles.byline}>
          <SourceAvatar sourceId={item.sourceId} sourceName={item.sourceName} size={isPhone ? 18 : 20} />
          <span className={styles.bylineSource}>{item.sourceName}</span>
          {byline && (
            <span className={styles.bylineAuthor}>
              {t('reader.by', { author: byline.replace(/^(par|by)\s+/i, '') })}
            </span>
          )}
        </p>
      )}
      <p className={styles.dateRow}>
        <time className="mono" dateTime={item.publishedAt ?? undefined}>
          {readable ? numericDate(item.publishedAt) : dateAndTime(item.publishedAt)}
        </time>
        <LanguageChip lang={item.lang} />
        {readable ? (
          readingMinutes && <ReadingTime minutes={readingMinutes} />
        ) : (
          <Chip>
            <ExternalLink size={12} aria-hidden="true" />
            {t('card.onSite')}
          </Chip>
        )}
      </p>
      <ShareNote articleId={item.id} className={styles.shareNote} />
    </header>
  )
}

interface AfterProps {
  related: RelatedItem[]
  next: ListedArticle | null
  layout: Layout
}

interface ReadableProps extends AfterProps {
  item: FeedItem
  canSummarize: boolean
  contentRef: RefObject<HTMLDivElement | null>
  contentHtml: string
  onUnauthorized: () => void
}

// The text, read in Hodi, with its source, the AI's summary and questions, and what to read after.
export const ReadableBody = (props: ReadableProps) => {
  const { item, canSummarize, contentRef, contentHtml, related, next, layout, onUnauthorized } = props
  const { t } = useTranslation()
  const textSize = useTextSize()
  return (
    <div className={`${styles.body} appear`}>
      {canSummarize && <SummaryCard articleId={item.id} onUnauthorized={onUnauthorized} />}
      {/* Sanitized by DOMPurify above: scripts, styles, forms and frames are removed. */}
      <div
        ref={contentRef}
        className={styles.content}
        style={{ '--text-scale': textSize.scale } as CSSProperties}
        // eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml -- sanitized by DOMPurify above
        dangerouslySetInnerHTML={{ __html: contentHtml }}
      />
      {/* The text ends with its source: whose article it is, what Hodi did to it, and the way to the original. */}
      <footer className={styles.attribution}>
        <p>
          <Trans i18nKey="reader.attribution" values={{ source: item.sourceName }} components={{ b: <b /> }} />
        </p>
        <div className={styles.attributionLinks}>
          <a className={styles.seeOn} href={item.link} target="_blank" rel="noopener noreferrer">
            {t('reader.readOriginal')}
            <ExternalLink size={12} aria-hidden="true" />
          </a>
          <ReaderActions
            id={item.id}
            title={item.title}
            url={item.link}
            sourceId={item.sourceId}
            sourceName={item.sourceName}
          />
        </div>
      </footer>
      {canSummarize && <QuestionsCard articleId={item.id} onUnauthorized={onUnauthorized} />}
      <ShareReply articleId={item.id} className={styles.reply} />
      {(related.length > 0 || next) && (
        // Past a line: what comes after the article, not the article.
        <div className={styles.after}>
          {related.length > 0 && <AlsoCovered related={related} />}
          {next && <NextArticle next={next} layout={layout} />}
        </div>
      )}
    </div>
  )
}

// An article Hodi cannot show: its summary from the feed and the way to its site; failed, a retry.
export const LinkBody = ({
  item,
  onRetry,
  related,
  next,
  layout
}: AfterProps & { item: FeedItem; onRetry: (() => void) | null }) => (
  <div className={`${styles.body} appear`}>
    <p className={styles.summary}>{item.summary}</p>
    <ExternalNotice item={item} onRetry={onRetry} />
    <ShareReply articleId={item.id} className={styles.reply} />
    {related.length > 0 && <AlsoCovered related={related} />}
    {next && <NextArticle next={next} layout={layout} />}
  </div>
)
