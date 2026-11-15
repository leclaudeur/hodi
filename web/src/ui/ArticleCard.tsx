import { AudioLines, Check, ExternalLink, EyeOff, Play } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { type MouseEvent, type ReactNode } from 'react'
import type { TopicItem } from '../api.ts'
import { useArticleImage } from '../lib/article-image.ts'
import { fadeIn } from '../lib/fade-in.ts'
import { formatDuration, shortAgo } from '../lib/format.ts'
import { highlightRanges } from '../lib/highlight.ts'
import { isPlayable, stateWords } from '../lib/listen.ts'
import { isDismissed } from '../lib/read-state.ts'
import { articleHref, watchHref } from '../lib/use-hash-route.ts'
import styles from './ArticleCard.module.css'
import BookmarkButton, { useIsSaved } from './BookmarkButton.tsx'
import Chip from './Chip.tsx'
import ReadingTime from './ReadingTime.tsx'
import RoundButton, { CARD_BUTTON } from './RoundButton.tsx'
import SourceAvatar from './SourceAvatar.tsx'
import LanguageChip from './LanguageChip.tsx'
import AlsoOn from './AlsoOn.tsx'

// row: the desktop lists. compact: a mobile row with its square picture. slide: a card in a horizontal slider.
export type CardVariant = 'row' | 'compact' | 'slide'

interface ArticleCardProps {
  item: TopicItem
  variant: CardVariant
  read?: boolean
  // Read cards fade back, except where they stay to be used (saved ones, history): there only "Lu" tells.
  fadeRead?: boolean
  // The article open in the reader beside the list (desktop).
  active?: boolean
  // The searched words, marked in the title.
  highlight?: string[]
  // Its text is kept on this device: it opens without a network.
  offline?: boolean
  // One more button beside the bookmark ("Marquer comme non lu" in the history).
  action?: ReactNode
  // "Masquer": put away without opening it. A button with a mouse; a phone swipes the card instead.
  onDismiss?: () => void
  // In place of the source ("Partages": who sent it), and of the article's age beside it ("Il reste 2 min").
  byline?: ReactNode
  note?: ReactNode
  // The word that came with a share, from whoever is in the byline.
  quote?: string | null
  // Only the action beside the source: no markers, no bookmark.
  plain?: boolean
  // The click on the title's link: it may open the article some other way (event.preventDefault()).
  onOpen?: (item: TopicItem, event: MouseEvent<HTMLAnchorElement>) => void
  // A key of the keyboard shortcuts on the title's link (data-shortcut).
  shortcut?: string
  // One of the first cards on screen: its picture loads at once and first, since it is what the eye waits for.
  priority?: boolean
}

// The title with the searched words marked.
const Highlighted = ({ text, words }: { text: string; words: string[] }) => {
  const parts: ReactNode[] = []
  let at = 0
  for (const [start, end] of highlightRanges(text, words)) {
    parts.push(text.slice(at, start), <mark key={start}>{text.slice(start, end)}</mark>)
    at = end
  }
  parts.push(text.slice(at))
  return <>{parts}</>
}

// A card's picture: the server's smaller copy at the width the card needs, over its blurred preview while it loads.
// When the server has none (a site that refused it), the site's own picture; when that fails too, the plain tile.
const Picture = ({
  item,
  sizes,
  className,
  priority = false,
  children
}: {
  item: TopicItem
  // The width the picture takes on screen, for srcset; a square crops a landscape picture, so it needs a wider one.
  sizes: string
  className?: string
  priority?: boolean
  children?: ReactNode
}) => {
  const image = useArticleImage(item.id, item.image, sizes)

  return (
    <span className={className}>
      {image?.srcSet && item.imagePreview && (
        <img className={styles.preview} src={item.imagePreview} alt="" aria-hidden="true" draggable={false} />
      )}
      {image && (
        <img
          {...fadeIn()}
          {...image}
          alt=""
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : undefined}
          decoding="async"
          draggable={false}
        />
      )}
      {children}
    </span>
  )
}

// A video or an episode, among articles: it plays in "Vidéos" rather than opening in the reader.
const PlayBadge = ({ item }: { item: TopicItem }) => (
  <span className={styles.play} aria-hidden="true">
    {item.kind === 'podcast' ? <AudioLines /> : <Play fill="currentColor" />}
  </span>
)

const DismissButton = ({ label, onDismiss }: { label: string; onDismiss: () => void }) => {
  const handleClick = (event: MouseEvent) => {
    // Cards are links: the button must not open the article.
    event.preventDefault()
    event.stopPropagation()
    onDismiss()
  }

  return (
    <RoundButton
      icon={EyeOff}
      label={label}
      size={28}
      className={`${CARD_BUTTON} ${styles.dismiss}`}
      data-dismiss
      onClick={handleClick}
    />
  )
}

// One or two markers at most: English, then the reading time or "on the site".
const Markers = ({
  item,
  read,
  offline,
  compact
}: {
  item: TopicItem
  read: boolean
  offline: boolean
  compact: boolean
}) => {
  const { t } = useTranslation()
  if (offline) {
    return (
      <Chip tone="success">
        <Check size={12} aria-hidden="true" />
        {t('card.offline')}
      </Chip>
    )
  }
  if (read) {
    return isDismissed(item.id) ? (
      <Chip>
        <EyeOff size={12} aria-hidden="true" />
        {stateWords(item).hidden}
      </Chip>
    ) : (
      <Chip>
        <Check size={12} aria-hidden="true" />
        {stateWords(item).read}
      </Chip>
    )
  }
  const isLink = item.access === 'link' && !isPlayable(item)
  return (
    <>
      <LanguageChip lang={item.lang} />
      {isLink ? (
        <Chip label={t('card.onSite')}>
          <ExternalLink size={12} aria-hidden="true" />
          {!compact && t('card.onSite')}
        </Chip>
      ) : (
        item.readingMinutes != null && <ReadingTime minutes={item.readingMinutes} />
      )}
    </>
  )
}

type TitleProps = Pick<ArticleCardProps, 'item' | 'onOpen' | 'shortcut' | 'active' | 'highlight'>

// The title, a link to the article (or to Vidéos for something to play).
const CardTitle = ({ item, onOpen, shortcut, active, highlight }: TitleProps) => (
  <h3 className={styles.title}>
    <a
      className={styles.link}
      // An article read on its site opens in Hodi too: its summary, and the way to the site.
      href={isPlayable(item) ? watchHref(item.id) : articleHref(item.id)}
      onClick={event => onOpen?.(item, event)}
      data-shortcut={shortcut}
      aria-current={active ? 'true' : undefined}
    >
      {highlight ? <Highlighted text={item.title} words={highlight} /> : item.title}
    </a>
  </h3>
)

const hideKindOf = (kind: TopicItem['kind']) => (kind === 'video' || kind === 'podcast' ? kind : 'article')

type MetaProps = Pick<ArticleCardProps, 'item' | 'variant' | 'byline' | 'action' | 'onDismiss'> & {
  age: ReactNode
  markers: ReactNode
  plain: boolean
  offline: boolean
}

// The source and its age, then the markers and the card's buttons.
const CardMeta = ({ item, variant, byline, age, markers, plain, offline, action, onDismiss }: MetaProps) => {
  const { t } = useTranslation()
  // A saved article cannot be put away by mistake: unsaved first.
  const saved = useIsSaved(item.id)
  const dismissable = onDismiss && !saved && (variant === 'row' || variant === 'compact')
  return (
    <div className={styles.meta}>
      <span className={styles.source}>
        {byline ?? (
          <>
            <SourceAvatar sourceId={item.sourceId} sourceName={item.sourceName} />
            <span className={styles.sourceName}>{item.sourceName}</span>
          </>
        )}
        {age && (
          <span className={styles.time}>
            <span aria-hidden="true">· </span>
            {age}
          </span>
        )}
      </span>
      <span className={styles.markers} data-card-meta>
        {!plain && markers}
        {action}
        {dismissable && <DismissButton label={t(`card.hideKind.${hideKindOf(item.kind)}`)} onDismiss={onDismiss} />}
        {!plain && (variant === 'row' || (variant === 'compact' && !offline)) && <BookmarkButton item={item} />}
      </span>
    </div>
  )
}

const ArticleCard = ({
  item,
  variant,
  read = false,
  fadeRead = true,
  active = false,
  highlight,
  offline = false,
  action,
  onDismiss,
  byline,
  note,
  quote,
  plain = false,
  onOpen,
  shortcut,
  priority = false
}: ArticleCardProps) => {
  // A saved video or episode opens in Vidéos.
  const playable = isPlayable(item)
  const related = item.related ?? []
  const compact = variant !== 'row'
  // Beside the source, short: "Numerama · 3 H". A video or an episode gives its length instead, once known.
  const length = playable && item.media?.durationSeconds ? formatDuration(item.media.durationSeconds) : null
  const age = note ?? length ?? shortAgo(item.publishedAt)
  const title = <CardTitle item={item} onOpen={onOpen} shortcut={shortcut} active={active} highlight={highlight} />
  const said = quote && <p className={styles.quote}>{quote}</p>
  const markers = <Markers item={item} read={read} offline={offline} compact={compact} />
  const meta = <CardMeta {...{ item, variant, byline, age, markers, plain, offline, action, onDismiss }} />
  const faded = read && fadeRead ? styles.read : ''

  if (variant === 'slide')
    return (
      <article className={[styles.card, styles[variant], faded].join(' ')} data-card={variant}>
        <Picture item={item} sizes="236px" className={styles.cover} priority={priority}>
          {playable && <PlayBadge item={item} />}
          <span className={styles.coverButton}>
            <BookmarkButton item={item} variant="image" size={44} />
          </span>
        </Picture>
        <div className={styles.body}>
          {title}
          {related.length > 0 && <AlsoOn related={related} compact />}
          {said}
          {meta}
        </div>
      </article>
    )

  return (
    <article
      className={[styles.card, styles[variant], active ? styles.active : '', faded].join(' ')}
      data-card={variant}
    >
      <div className={styles.top}>
        <div className={styles.text}>
          {title}
          {variant === 'row' && item.summary && <p className={styles.summary}>{item.summary}</p>}
          {variant === 'compact' && related.length > 0 && <AlsoOn related={related} compact />}
        </div>
        {item.image !== null && (
          <Picture
            item={item}
            sizes={variant === 'row' ? '114px' : '144px'}
            className={styles.thumb}
            priority={priority}
          >
            {playable && <PlayBadge item={item} />}
          </Picture>
        )}
      </div>
      {variant === 'row' && related.length > 0 && <AlsoOn related={related} compact={false} />}
      {said}
      {/* Under the picture too on a phone: the source and its age keep the whole width. */}
      {meta}
    </article>
  )
}

export default ArticleCard
