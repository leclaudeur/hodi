import { AlertCircle, ArrowRight, ExternalLink, Layers, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { FeedItem, RelatedItem } from '../../api.ts'
import type { ListedArticle } from '../../lib/reading-list.ts'
import type { SpeechState } from '../../lib/speech.ts'
import { articleHref } from '../../lib/use-hash-route.ts'
import ArticleCard from '../../ui/ArticleCard.tsx'
import ArticleLinkCard from '../../ui/ArticleLinkCard.tsx'
import Button from '../../ui/Button.tsx'
import EmptyState from '../../ui/EmptyState.tsx'
import Notice from '../../ui/Notice.tsx'
import RoundButton from '../../ui/RoundButton.tsx'
import { Bar } from '../../ui/Skeleton.tsx'
import styles from './Reader.module.css'

export type Layout = 'desktop' | 'phone'

// Opens the next article in place of this one: going back still leads to the list.
const openInPlace = (href: string) => (event: { preventDefault: () => void }) => {
  event.preventDefault()
  window.location.replace(href)
}

// The other sources on the same story, those that open in Hodi first.
export const AlsoCovered = ({ related }: { related: RelatedItem[] }) => {
  const { t } = useTranslation()
  const sorted = [...related].sort((a, b) => Number(b.access === 'reader') - Number(a.access === 'reader'))

  return (
    <aside className={styles.covered} aria-label={t('reader.alsoCovered')}>
      <div className={styles.sectionLabel}>
        <Layers size={14} aria-hidden="true" />
        <span>{t('reader.alsoCovered')}</span>
        <span className={styles.rule} />
        <span>{t('count.source', { count: related.length })}</span>
      </div>
      <ul className={styles.coveredList}>
        {sorted.map(other => {
          const external = other.access === 'link'
          return (
            <li key={other.id}>
              <ArticleLinkCard
                articleId={other.id}
                title={other.title}
                href={articleHref(other.id)}
                sourceId={other.sourceId ?? ''}
                sourceName={other.sourceName}
                image={other.image}
                minutes={other.readingMinutes}
                external={external}
              />
            </li>
          )
        })}
      </ul>
    </aside>
  )
}

// "Article suivant": the next one of the list the article was opened from, as the fil's card.
export const NextArticle = ({ next, layout }: { next: ListedArticle; layout: Layout }) => {
  const { t } = useTranslation()
  return (
    <nav className={styles.next} aria-label={t('reader.next')}>
      <div className={styles.sectionLabel}>
        <ArrowRight size={14} aria-hidden="true" />
        <span>{t('reader.next')}</span>
        <span className={styles.rule} />
      </div>
      <ArticleCard
        item={next}
        variant={layout === 'phone' ? 'compact' : 'row'}
        shortcut="next"
        onOpen={(_item, event) => openInPlace(articleHref(next.id))(event)}
      />
    </nav>
  )
}

// The reader's loading state, from the charter's "Chargement" board.
export const ReaderSkeleton = ({ layout }: { layout: Layout }) => (
  <div className={`${styles.skeleton} ${styles[layout]}`} aria-hidden="true">
    {layout === 'desktop' && (
      <div className={styles.skeletonBar}>
        <span className={styles.skeletonSource}>
          <Bar width={22} height={22} radius={6} />
          <Bar width={90} height={12} />
        </span>
        <span className={styles.skeletonSource}>
          <Bar width={36} height={36} radius={18} />
          <Bar width={36} height={36} radius={18} />
          <Bar width={36} height={36} radius={18} />
        </span>
      </div>
    )}
    <div className={styles.skeletonHeader}>
      <Bar width={96} height={24} radius={12} />
      <Bar width="92%" height={34} radius={8} />
      <Bar width="70%" height={34} radius={8} />
      <Bar width={180} height={12} />
      <Bar width={140} height={10} />
    </div>
    <div className={styles.skeletonLines}>
      <Bar width="100%" height={13} />
      <Bar width="96%" height={13} />
      <Bar width="88%" height={13} />
      <Bar width="60%" height={13} />
    </div>
  </div>
)

// The "Escape" shortcut's target on a computer, where the reader has no visible back button.
export const BackShortcut = ({ onBack }: { onBack: () => void }) => {
  const { t } = useTranslation()
  return (
    <button type="button" className="visually-hidden" onClick={onBack} data-shortcut="back" tabIndex={-1}>
      {t('common.back')}
    </button>
  )
}

// An article Hodi cannot show: its summary from the feed, and the way to its site.
// failed (onRetry): the site did not answer, asking again may work.
export const ExternalNotice = ({ item, onRetry }: { item: FeedItem; onRetry: (() => void) | null }) => {
  const { t } = useTranslation()
  return (
    <Notice
      icon={ExternalLink}
      title={t(onRetry ? 'reader.sourceDown' : 'reader.notInHodi', { source: item.sourceName })}
      href={item.link}
      side={
        <>
          {onRetry && <RoundButton icon={RefreshCw} label={t('common.retry')} size={44} onClick={onRetry} />}
          <RoundButton
            icon={ExternalLink}
            label={t('reader.readOn', { source: item.sourceName })}
            variant="on"
            size={44}
            href={item.link}
            external
          />
        </>
      }
    >
      {t('reader.externalText')}
    </Notice>
  )
}

// Stays at hand while the voice reads the article (phone: the computer's reader bar has the controls).
export const SpeechPlayer = ({
  state,
  onToggle,
  onStop
}: {
  state: SpeechState
  onToggle: () => void
  onStop: () => void
}) => {
  const { t } = useTranslation()
  return (
    <div className={styles.player} role="group" aria-label={t('speech.player')}>
      {state === 'loading' ? (
        <span className={styles.playerWait} role="status">
          {t('speech.preparingShort')}
        </span>
      ) : (
        <button type="button" onClick={onToggle}>
          {t(state === 'playing' ? 'speech.pauseShort' : 'speech.resumeShort')}
        </button>
      )}
      <button type="button" onClick={onStop}>
        {t('speech.stop')}
      </button>
    </div>
  )
}

// The article did not come: a retry, and the saved articles still open offline.
export const ReaderFailed = ({ onRetry }: { onRetry: () => void }) => {
  const { t } = useTranslation()
  return (
    <EmptyState
      tone="danger"
      icon={<AlertCircle size={28} />}
      title={t('reader.loadFailed')}
      actions={
        <Button look="primary" onClick={onRetry} icon={RefreshCw}>
          {t('common.retry')}
        </Button>
      }
    >
      {t('feed.savedOffline')}
    </EmptyState>
  )
}
