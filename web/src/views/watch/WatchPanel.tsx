import { ArrowLeft, ExternalLink } from 'lucide-react'
import { Suspense, lazy, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { FeedItem, ItemMedia } from '../../api.ts'
import { numericDate } from '../../lib/format.ts'
import { asSaved, findListenItem, useListen } from '../../lib/listen.ts'
import { closeArticle, markRead } from '../../lib/read-state.ts'
import { useSaved } from '../../lib/saved.ts'
import BookmarkButton from '../../ui/BookmarkButton.tsx'
import PhoneHeader from '../../ui/PhoneHeader.tsx'
import RoundButton from '../../ui/RoundButton.tsx'
import { Bar } from '../../ui/Skeleton.tsx'
import SourceAvatar from '../../ui/SourceAvatar.tsx'
import TopicCapsule from '../../ui/TopicCapsule.tsx'
import NotFound from '../NotFound.tsx'
import ShareMenu from '../reader/ShareMenu.tsx'
import { ShareNote, ShareReply } from '../reader/ShareNote.tsx'
import ShareToButton from '../reader/ShareToButton.tsx'
import { contentDays } from '../../lib/content-days.ts'
import styles from './WatchPanel.module.css'

// Video.js and its YouTube adapter load with the first video opened, not with the app.
const WatchPlayer = lazy(() => import('./WatchPlayer.tsx'))

const hasMedia = (item: FeedItem): item is FeedItem & { media: ItemMedia } => item.media !== null

const PlayerPlaceholder = () => <div className={styles.placeholder} aria-hidden="true" />

// The panel's place while the list comes.
const WatchSkeleton = ({ layout }: { layout: 'desktop' | 'phone' }) => (
  <div className={`${styles.panel} ${styles[layout]}`} aria-busy="true">
    <div className={styles.bar}>
      <Bar width={120} height={14} />
    </div>
    <PlayerPlaceholder />
    <div className={styles.header}>
      <Bar width="80%" height={30} />
      <Bar width="50%" height={30} />
    </div>
  </div>
)

// Save, send to someone of the household, share, and open it where it comes from.
const WatchActions = ({ item, size }: { item: FeedItem; size: 34 | 44 }) => {
  const { t } = useTranslation()
  return (
    <span className={styles.actions}>
      <BookmarkButton item={asSaved(item)} variant="round" size={size} />
      <ShareToButton articleId={item.id} size={size} />
      <ShareMenu url={item.link} title={item.title} kind={item.kind} size={size} />
      <RoundButton
        icon={ExternalLink}
        label={t(item.media?.type === 'youtube' ? 'videos.openYouTube' : 'videos.openSite')}
        href={item.link}
        external
        size={size}
      />
    </span>
  )
}

interface WatchPanelProps {
  itemId: string
  layout: 'desktop' | 'phone'
  onBack: () => void
  onUnauthorized: () => void
}

// A video or an episode, played here: the player, then what it is about. Share sends its own link; one sent
// here by someone of the household shows who sent it on top, and takes an emoji back under it.
const WatchPanel = ({ itemId, layout, onBack, onUnauthorized }: WatchPanelProps) => {
  const { t } = useTranslation()
  const { feed, error } = useListen(onUnauthorized)
  const saved = useSaved()
  const found = findListenItem(feed, itemId)
  // Saved, and gone from the last 60 days: it still plays.
  const item: FeedItem | null = found?.item ?? saved.find(entry => entry.item.id === itemId)?.item ?? null
  const isPhone = layout === 'phone'

  // Seen once opened; under "Masquer les articles lus et les vidéos vues", it leaves the list when closed.
  useEffect(() => {
    markRead(itemId)
    return () => closeArticle(itemId)
  }, [itemId])

  if (!item) {
    if (feed || error)
      return <NotFound title={t('videos.gone')}>{t('videos.goneText', { count: contentDays().videoDays })}</NotFound>

    return <WatchSkeleton layout={layout} />
  }

  const actions = <WatchActions item={item} size={isPhone ? 44 : 34} />

  return (
    <article className={`${styles.panel} ${styles[layout]}`} aria-label={item.title}>
      {isPhone ? (
        <PhoneHeader
          back={<RoundButton icon={ArrowLeft} label={t('videos.backToList')} size={44} onClick={onBack} />}
          actions={actions}
          sticky
          line
          className={styles.phoneHeader}
        />
      ) : (
        <div className={styles.bar}>
          <span className={styles.source}>
            <SourceAvatar sourceId={item.sourceId} sourceName={item.sourceName} size={22} />
            <span className={styles.channelName}>{item.sourceName}</span>
          </span>
          {actions}
        </div>
      )}

      <header className={styles.header}>
        {found && found.sectionId !== 'other' && (
          <TopicCapsule topicId={found.sectionId} label={found.sectionLabel} href={null} />
        )}
        <h1 className={styles.title}>{item.title}</h1>
        <p className={styles.byline}>
          <span className={styles.channel}>
            <SourceAvatar sourceId={item.sourceId} sourceName={item.sourceName} size={20} />
            <span className={styles.channelName}>{item.sourceName}</span>
          </span>
        </p>
        {item.publishedAt && <p className={styles.date}>{numericDate(item.publishedAt)}</p>}
        <ShareNote articleId={item.id} />
      </header>

      {/* Wider than the text on a wide panel, across the screen on a phone: as the articles' covers were. */}
      <div className={styles.media}>
        {hasMedia(item) ? (
          <Suspense fallback={<PlayerPlaceholder />}>
            <WatchPlayer key={item.id} item={item} />
          </Suspense>
        ) : (
          <PlayerPlaceholder />
        )}
      </div>

      {item.summary && <p className={styles.summary}>{item.summary}</p>}
      {/* Sent by someone of the household: an emoji back, as under an article. */}
      <ShareReply articleId={item.id} className={styles.reply} />
    </article>
  )
}

export default WatchPanel
