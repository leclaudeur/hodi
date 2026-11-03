import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  AudioLines,
  ExternalLink,
  Layers,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  Square
} from 'lucide-react'
import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { type ArticleResult, type FeedItem, type RelatedItem, UnauthorizedError, getArticle } from '../../api.ts'
import { hostOf, numericDate } from '../../lib/format.ts'
import { closeArticle, markRead } from '../../lib/read-state.ts'
import { type ListedArticle, nextArticle } from '../../lib/reading-list.ts'
import { relatedOf, topicOfArticle } from '../../lib/related.ts'
import { finishArticle } from '../../lib/article-embeds.ts'
import { loadSanitizer } from '../../lib/deferred.ts'
import { findSaved, save } from '../../lib/saved.ts'
import { type SpeechState, useSpeech } from '../../lib/speech.ts'
import { useTextSize } from '../../lib/text-size.ts'
import { articleHref } from '../../lib/use-hash-route.ts'
import ArticleCard from '../../ui/ArticleCard.tsx'
import ArticleLinkCard from '../../ui/ArticleLinkCard.tsx'
import BookmarkButton from '../../ui/BookmarkButton.tsx'
import Button from '../../ui/Button.tsx'
import Chip from '../../ui/Chip.tsx'
import EmptyState from '../../ui/EmptyState.tsx'
import Notice from '../../ui/Notice.tsx'
import PhoneHeader from '../../ui/PhoneHeader.tsx'
import ReadingTime from '../../ui/ReadingTime.tsx'
import RoundButton from '../../ui/RoundButton.tsx'
import { Bar } from '../../ui/Skeleton.tsx'
import SourceAvatar from '../../ui/SourceAvatar.tsx'
import SparkleIcon from '../../ui/SparkleIcon.tsx'
import TopicCapsule from '../../ui/TopicCapsule.tsx'
import NotFound from '../NotFound.tsx'
import QuestionsCard from './QuestionsCard.tsx'
import styles from './Reader.module.css'
import ReadingBar from './ReadingBar.tsx'
import { useReadingProgress } from './reading-progress.ts'
import ShareMenu from './ShareMenu.tsx'
import { ShareNote, ShareReply } from './ShareNote.tsx'
import ShareToButton from './ShareToButton.tsx'
import SummaryCard from './SummaryCard.tsx'
import LanguageChip from '../../ui/LanguageChip.tsx'
import { Trans, useTranslation } from 'react-i18next'

type Layout = 'desktop' | 'phone'

// "24.10.2026 · 18:42", the date of an article read on its site.
const dateAndTime = (iso: string | null) => {
  const date = numericDate(iso)
  if (!iso || !date) return null
  const at = new Date(iso)
  return `${date} · ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

// About 230 words a minute.
const WORDS_A_MINUTE = 230
const wordsOf = (html: string) =>
  new DOMParser().parseFromString(html, 'text/html').body.textContent?.match(/\S+/g)?.length ?? 0

// Opens the next article in place of this one: going back still leads to the list.
const openInPlace = (href: string) => (event: { preventDefault: () => void }) => {
  event.preventDefault()
  window.location.replace(href)
}

// The other sources on the same story, those that open in Hodi first.
const AlsoCovered = ({ related }: { related: RelatedItem[] }) => {
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
const NextArticle = ({ next, layout }: { next: ListedArticle; layout: Layout }) => {
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
const ReaderSkeleton = ({ layout }: { layout: Layout }) => (
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

interface ReaderProps {
  articleId: string
  layout: Layout
  // A tablet held across shows the desktop reader in place of the list: with a visible back button.
  withBack?: boolean
  onBack: () => void
  onUnauthorized: () => void
}

// The article, read in Hodi: in the panel beside the list on a computer, full screen on a phone.
// Rendered with key={articleId}: each article starts from its own state.
const Reader = ({ articleId, layout, withBack = false, onBack, onUnauthorized }: ReaderProps) => {
  const { t } = useTranslation()
  const [result, setResult] = useState<ArticleResult | null>(null)
  const [error, setError] = useState(false)
  // "Réessayer" asks the server again.
  const [attempt, setAttempt] = useState(0)
  const retry = () => {
    setError(false)
    setResult(null)
    setAttempt(count => count + 1)
  }
  const [scrolled, setScrolled] = useState(false)
  // Set with the first result: see the article's effect.
  const [sanitize, setSanitize] = useState<((html: string, articleId?: string) => string) | null>(null)
  const textSize = useTextSize()
  const content = useRef<HTMLDivElement>(null)
  const title = useRef<HTMLHeadingElement>(null)
  const shown = result?.status === 'ok' ? result.item : null
  const speech = useSpeech(content, shown?.lang ?? 'fr')

  useEffect(() => {
    let cancelled = false

    markRead(articleId)
    window.scrollTo({ top: 0 })

    // A saved article keeps its text in this browser: it still opens once out of the feeds or offline.
    const saved = findSaved(articleId)
    const savedResult: ArticleResult | null = saved?.article
      ? { status: 'ok', item: saved.item, article: saved.article }
      : null

    // The sanitizer (DOMPurify) comes in its own file, alongside the article: the text shows once both are here.
    const sanitizer = loadSanitizer()
    const show = (next: ArticleResult) =>
      sanitizer.then(
        ({ sanitizeArticle }) => {
          if (cancelled) return
          // One render: the text and its sanitizer arrive together.
          setSanitize(() => sanitizeArticle)
          setResult(next)
        },
        () => !cancelled && setError(true)
      )

    getArticle(articleId)
      .then(next => {
        if (cancelled) return
        if (next.status === 'ok' && saved && !saved.article) save(saved.item, next.article)
        return show(next.status === 'ok' ? next : (savedResult ?? next))
      })
      .catch((loadError: unknown) => {
        if (cancelled) return
        if (loadError instanceof UnauthorizedError) onUnauthorized()
        else if (savedResult) void show(savedResult)
        else setError(true)
      })

    return () => {
      cancelled = true
    }
  }, [articleId, attempt, onUnauthorized])

  // Back to the list, or on to another article: under "Masquer les articles lus", this one goes.
  useEffect(() => () => closeArticle(articleId), [articleId])

  const contentHtml = useMemo(
    () => (result?.status === 'ok' && sanitize ? sanitize(result.article.contentHtml, result.item.id) : ''),
    [result, sanitize]
  )
  const words = useMemo(() => wordsOf(contentHtml), [contentHtml])
  const readingMinutes = words > 0 ? Math.max(1, Math.round(words / WORDS_A_MINUTE)) : null

  // Logos on embedded posts and videos, and the layout of groups of pictures once their size is known.
  useEffect(() => (content.current ? finishArticle(content.current) : undefined), [contentHtml])

  // Counted in the reading stats once the text is shown, read for good or only skimmed.
  useReadingProgress(
    content,
    result?.status === 'ok'
      ? {
          id: result.item.id,
          sourceId: result.item.sourceId,
          sourceName: result.item.sourceName,
          estimate: readingMinutes ?? 0,
          exact: words / WORDS_A_MINUTE
        }
      : null
  )

  // A picture that cannot load (offline: only the text is kept) leaves no broken frame, nor its caption.
  useEffect(() => {
    const element = content.current
    if (!element) return
    const hideImage = (image: HTMLElement) => {
      const frame = image.closest('figure') ?? image
      frame.style.display = 'none'
    }
    // The server's smaller copies failed: the site's own picture, then nothing.
    const fallBack = (image: HTMLImageElement) => {
      if (!image.srcset) return hideImage(image)
      image.removeAttribute('srcset')
      image.removeAttribute('sizes')
    }
    const hide = (event: Event) => fallBack(event.target as HTMLImageElement)
    // A figure takes its picture's width: until the picture arrives it has none, and the caption would be squeezed
    // into a narrow column. The figure keeps the column's width while its picture loads.
    const loaded = (event: Event) => delete (event.target as HTMLElement).closest('figure')?.dataset.loading
    const images = [...element.querySelectorAll('img')]
    images.forEach(image => {
      image.addEventListener('error', hide)
      if (image.complete && image.naturalWidth === 0 && image.currentSrc) fallBack(image)
      const figure = image.closest('figure')
      if (figure && !image.complete) {
        figure.dataset.loading = ''
        image.addEventListener('load', loaded)
        image.addEventListener('error', loaded)
      }
    })
    return () =>
      images.forEach(image => {
        image.removeEventListener('error', hide)
        image.removeEventListener('load', loaded)
        image.removeEventListener('error', loaded)
      })
  }, [contentHtml])

  // Once the title has scrolled away, the desktop bar shows it and the phone's buttons get a band
  // under them: watched, not computed on every scroll.
  const hasItem = result !== null && result.status !== 'not_found'
  useEffect(() => {
    const element = title.current
    if (!element) return
    const observer = new IntersectionObserver(([entry]) => setScrolled(entry ? !entry.isIntersecting : false), {
      rootMargin: `${layout === 'desktop' ? -64 : -88}px 0px 0px 0px`
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [hasItem, layout])

  const isPhone = layout === 'phone'
  // Touch sizes on a tablet, as everywhere a finger is expected.
  const barSize = withBack ? 44 : 34
  const desktopBack = withBack ? (
    <RoundButton icon={ArrowLeft} label={t('common.back')} size={44} onClick={onBack} data-shortcut="back" />
  ) : (
    <BackShortcut onBack={onBack} />
  )
  // Glass over the article's picture, as its other buttons; plain on the header's band.
  const backButton = (glass: boolean) => (
    <RoundButton
      icon={ArrowLeft}
      label={t('common.back')}
      size={44}
      variant={glass ? 'glass' : 'default'}
      onClick={onBack}
      data-shortcut="back"
      className={styles.backButton}
    />
  )

  if (result?.status === 'not_found') {
    return (
      <article className={`${styles.reader} ${styles[layout]}`}>
        {isPhone ? (
          <PhoneHeader back={backButton(false)} />
        ) : withBack ? (
          <div className={styles.backRow}>{desktopBack}</div>
        ) : (
          desktopBack
        )}
        <NotFound />
      </article>
    )
  }

  if (error) {
    return (
      <article className={`${styles.reader} ${styles[layout]}`}>
        {isPhone ? (
          <PhoneHeader back={backButton(false)} />
        ) : withBack ? (
          <div className={styles.backRow}>{desktopBack}</div>
        ) : (
          desktopBack
        )}
        <EmptyState
          tone="danger"
          icon={<AlertCircle size={28} />}
          title={t('reader.loadFailed')}
          actions={
            <Button look="primary" onClick={retry} icon={RefreshCw}>
              {t('common.retry')}
            </Button>
          }
        >
          {t('feed.savedOffline')}
        </EmptyState>
      </article>
    )
  }

  if (!result) {
    return (
      <article className={`${styles.reader} ${styles[layout]}`} aria-busy="true">
        {isPhone ? (
          <PhoneHeader back={backButton(false)} />
        ) : withBack ? (
          <div className={styles.backRow}>{desktopBack}</div>
        ) : (
          desktopBack
        )}
        <ReaderSkeleton layout={layout} />
      </article>
    )
  }

  const { item } = result
  const readable = result.status === 'ok'
  const canSummarize = readable && result.canSummarize === true
  const related = relatedOf(item.id)
  const next = nextArticle(item.id)
  const topic = topicOfArticle(item.id)
  const byline = readable ? result.article.byline : null
  const bookmarkItem = { ...item, access: readable ? 'reader' : 'link', readingMinutes } as const
  const speaking = speech.state !== 'idle'
  const speechLabel = t(
    speech.state === 'playing'
      ? 'speech.pause'
      : speech.state === 'paused'
        ? 'speech.resume'
        : speech.state === 'loading'
          ? 'speech.preparing'
          : 'speech.listenArticle'
  )
  const listenButton = readable && speech.supported && (
    <RoundButton
      icon={
        speech.state === 'playing'
          ? Pause
          : speech.state === 'paused'
            ? Play
            : speech.state === 'loading'
              ? LoaderCircle
              : AudioLines
      }
      busy={speech.state === 'loading'}
      label={speechLabel}
      size={isPhone ? 44 : barSize}
      variant={speaking ? 'on' : isPhone ? 'glass' : 'default'}
      aria-pressed={speaking}
      onClick={() => speech.toggle()}
    />
  )

  // The article on its site, as the videos' header.
  const siteButton = (size: 34 | 44) => (
    <RoundButton
      icon={ExternalLink}
      label={t('reader.openOn', { site: hostOf(item.link) })}
      title={t('reader.openOn', { site: hostOf(item.link) })}
      href={item.link}
      external
      size={size}
    />
  )

  // Phones: the floating violet button opens the summary offer, and spends a call only from there.
  const openSummary = () => {
    const summary = document.getElementById('summary')
    summary?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    summary?.querySelector<HTMLButtonElement>('[data-shortcut="summarize"]')?.click()
  }

  const header = (
    <header className={`${styles.header} appear`}>
      {topic && <TopicCapsule topicId={topic.id} label={topic.label} />}
      <h1 ref={title} className={styles.title}>
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

  const body: ReactNode = readable ? (
    <div className={`${styles.body} appear`}>
      {canSummarize && <SummaryCard articleId={item.id} onUnauthorized={onUnauthorized} />}
      {/* Sanitized by DOMPurify above: scripts, styles, forms and frames are removed. */}
      <div
        ref={content}
        className={styles.content}
        style={{ '--text-scale': textSize.scale } as CSSProperties}
        dangerouslySetInnerHTML={{ __html: contentHtml }}
      />
      {/* The text ends with its source: whose article it is, what Hodi did to it, and the way to the original. */}
      <footer className={styles.attribution}>
        <p>
          <Trans i18nKey="reader.attribution" values={{ source: item.sourceName }} components={{ b: <b /> }} />
        </p>
        <a className={styles.seeOn} href={item.link} target="_blank" rel="noopener noreferrer">
          {t('reader.readOriginal')}
          <ExternalLink size={12} aria-hidden="true" />
        </a>
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
  ) : (
    <div className={`${styles.body} appear`}>
      <p className={styles.summary}>{item.summary}</p>
      <ExternalNotice item={item} onRetry={result.status === 'failed' ? retry : null} />
      <ShareReply articleId={item.id} className={styles.reply} />
      {related.length > 0 && <AlsoCovered related={related} />}
      {next && <NextArticle next={next} layout={layout} />}
    </div>
  )

  if (isPhone)
    return (
      <article className={`${styles.reader} ${styles.phone}`} lang={item.lang} data-reader>
        <PhoneHeader
          back={backButton(false)}
          actions={
            <span className={styles.actions}>
              <BookmarkButton item={bookmarkItem} variant="round" size={44} />
              <ShareToButton articleId={item.id} size={44} />
              <ShareMenu url={item.link} title={item.title} size={44} />
              {siteButton(44)}
            </span>
          }
          line={readable ? <ReadingBar target={content} /> : true}
          sticky
        />
        {header}
        {body}
        {/* Held to the screen's bottom from the page's root: inside the reader, Safari on a tablet let them
            scroll away with the article. */}
        {createPortal(
          <>
            <div className={styles.fade} aria-hidden="true" />
            <div className={styles.fabs}>
              {listenButton || <span />}
              {canSummarize && (
                <button
                  className={styles.aiFab}
                  type="button"
                  onClick={openSummary}
                  aria-label={t('summary.summarizeArticle')}
                >
                  <SparkleIcon size={18} />
                </button>
              )}
            </div>
            {speaking && <SpeechPlayer state={speech.state} onToggle={() => speech.toggle()} onStop={speech.stop} />}
          </>,
          document.body
        )}
      </article>
    )

  return (
    <article
      className={`${styles.reader} ${styles.desktop} ${withBack ? styles.across : ''}`}
      lang={item.lang}
      data-reader
    >
      {!withBack && desktopBack}
      <div className={`${styles.bar} ${scrolled ? styles.scrolled : ''}`}>
        <div className={styles.barInner}>
          <span className={styles.barStart}>
            {withBack && desktopBack}
            <span className={styles.barSource}>
              <SourceAvatar sourceId={item.sourceId} sourceName={item.sourceName} size={22} />
              <span className={styles.barSourceName}>{item.sourceName}</span>
            </span>
          </span>
          {/* Once the title has scrolled away: in the middle, as on a phone. */}
          <span className={styles.barTitle} aria-hidden={!scrolled}>
            <span className={styles.barTitleText}>{item.title}</span>
          </span>
          <span className={styles.actions}>
            <BookmarkButton item={bookmarkItem} variant="round" size={barSize} />
            <ShareToButton articleId={item.id} size={barSize} />
            {listenButton}
            {speaking && (
              <RoundButton icon={Square} label={t('speech.stopLabel')} size={barSize} onClick={speech.stop} />
            )}
            <ShareMenu url={item.link} title={item.title} size={barSize} />
            {siteButton(barSize)}
          </span>
        </div>
        {/* From the start: a short text, all on screen, never scrolls and shows it full at once. */}
        {readable && <ReadingBar target={content} />}
      </div>
      {header}
      {body}
    </article>
  )
}

// The "Escape" shortcut's target on a computer, where the reader has no visible back button.
const BackShortcut = ({ onBack }: { onBack: () => void }) => {
  const { t } = useTranslation()
  return (
    <button type="button" className="visually-hidden" onClick={onBack} data-shortcut="back" tabIndex={-1}>
      {t('common.back')}
    </button>
  )
}

// An article Hodi cannot show: its summary from the feed, and the way to its site.
// failed (onRetry): the site did not answer, asking again may work.
const ExternalNotice = ({ item, onRetry }: { item: FeedItem; onRetry: (() => void) | null }) => {
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
const SpeechPlayer = ({
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

export default Reader
