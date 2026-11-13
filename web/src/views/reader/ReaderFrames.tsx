import { ArrowLeft, AudioLines, ExternalLink, LoaderCircle, Pause, Play, Square } from 'lucide-react'
import type { ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { FeedItem, TopicItem } from '../../api.ts'
import { hostOf } from '../../lib/format.ts'
import type { SpeechState } from '../../lib/speech.ts'
import BookmarkButton from '../../ui/BookmarkButton.tsx'
import PhoneHeader from '../../ui/PhoneHeader.tsx'
import RoundButton from '../../ui/RoundButton.tsx'
import SourceAvatar from '../../ui/SourceAvatar.tsx'
import SparkleIcon from '../../ui/SparkleIcon.tsx'
import styles from './Reader.module.css'
import { BackShortcut, type Layout, SpeechPlayer } from './ReaderParts.tsx'
import ReadingBar from './ReadingBar.tsx'
import ShareMenu from './ShareMenu.tsx'
import ShareToButton from './ShareToButton.tsx'

// Glass over the article's picture, as its other buttons; plain on the header's band.
const BackButton = ({ glass, onBack }: { glass: boolean; onBack: () => void }) => {
  const { t } = useTranslation()
  return (
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
}

// A tablet held across shows a visible back button; a computer only the Escape shortcut's target.
export const DesktopBack = ({ withBack, onBack }: { withBack: boolean; onBack: () => void }) => {
  const { t } = useTranslation()
  if (!withBack) return <BackShortcut onBack={onBack} />
  return <RoundButton icon={ArrowLeft} label={t('common.back')} size={44} onClick={onBack} data-shortcut="back" />
}

interface ShellProps {
  layout: Layout
  withBack: boolean
  busy?: boolean
  onBack: () => void
  children: ReactNode
}

// The reader without an article yet: loading, not found or failed, with its way back.
export const ReaderShell = ({ layout, withBack, busy, onBack, children }: ShellProps) => {
  let back = <DesktopBack withBack={withBack} onBack={onBack} />
  if (layout === 'phone') back = <PhoneHeader back={<BackButton glass={false} onBack={onBack} />} />
  else if (withBack) back = <div className={styles.backRow}>{back}</div>
  return (
    <article className={`${styles.reader} ${styles[layout]}`} aria-busy={busy}>
      {back}
      {children}
    </article>
  )
}

const SPEECH_LABELS = {
  playing: 'speech.pause',
  paused: 'speech.resume',
  loading: 'speech.preparing',
  idle: 'speech.listenArticle'
} as const

const SPEECH_ICONS = { playing: Pause, paused: Play, loading: LoaderCircle, idle: AudioLines }

interface ListenProps {
  state: SpeechState
  isPhone: boolean
  size: 34 | 44
  onToggle: () => void
}

// Reads the article aloud, in the browser's voice.
export const ListenButton = ({ state, isPhone, size, onToggle }: ListenProps) => {
  const { t } = useTranslation()
  const idleLook = isPhone ? 'glass' : 'default'
  return (
    <RoundButton
      icon={SPEECH_ICONS[state]}
      busy={state === 'loading'}
      label={t(SPEECH_LABELS[state])}
      size={size}
      variant={state === 'idle' ? idleLook : 'on'}
      aria-pressed={state !== 'idle'}
      onClick={onToggle}
    />
  )
}

// The article on its site, as the videos' header.
const SiteButton = ({ link, size }: { link: string; size: 34 | 44 }) => {
  const { t } = useTranslation()
  return (
    <RoundButton
      icon={ExternalLink}
      label={t('reader.openOn', { site: hostOf(link) })}
      title={t('reader.openOn', { site: hostOf(link) })}
      href={link}
      external
      size={size}
    />
  )
}

// Phones: the floating violet button opens the summary offer, and spends a call only from there.
const openSummary = () => {
  const summary = document.getElementById('summary')
  summary?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  summary?.querySelector<HTMLButtonElement>('[data-shortcut="summarize"]')?.click()
}

export interface FrameProps {
  item: FeedItem
  readable: boolean
  canSummarize: boolean
  bookmarkItem: TopicItem
  contentRef: RefObject<HTMLDivElement | null>
  header: ReactNode
  body: ReactNode
  listen: ReactNode
  speechState: SpeechState
  onToggleSpeech: () => void
  onStopSpeech: () => void
  onBack: () => void
}

// Full screen on a phone: its buttons on top, the voice and the summary at the bottom.
export const PhoneReader = (props: FrameProps) => {
  const { item, readable, canSummarize, bookmarkItem, contentRef, header, body, listen } = props
  const { t } = useTranslation()
  return (
    <article className={`${styles.reader} ${styles.phone}`} lang={item.lang} data-reader>
      <PhoneHeader
        back={<BackButton glass={false} onBack={props.onBack} />}
        actions={
          <span className={styles.actions}>
            <BookmarkButton item={bookmarkItem} variant="round" size={44} />
            <ShareToButton articleId={item.id} size={44} />
            <ShareMenu url={item.link} title={item.title} size={44} />
            <SiteButton link={item.link} size={44} />
          </span>
        }
        line={readable ? <ReadingBar target={contentRef} /> : true}
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
            {listen || <span />}
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
          {props.speechState !== 'idle' && (
            <SpeechPlayer state={props.speechState} onToggle={props.onToggleSpeech} onStop={props.onStopSpeech} />
          )}
        </>,
        document.body
      )}
    </article>
  )
}

// Beside the list on a computer: a bar with the source, the title once scrolled, and the buttons.
export const DesktopReader = (props: FrameProps & { withBack: boolean; scrolled: boolean; barSize: 34 | 44 }) => {
  const { item, readable, bookmarkItem, contentRef, header, body, listen, withBack, scrolled, barSize } = props
  const { t } = useTranslation()
  const back = <DesktopBack withBack={withBack} onBack={props.onBack} />
  return (
    <article
      className={`${styles.reader} ${styles.desktop} ${withBack ? styles.across : ''}`}
      lang={item.lang}
      data-reader
    >
      {!withBack && back}
      <div className={`${styles.bar} ${scrolled ? styles.scrolled : ''}`}>
        <div className={styles.barInner}>
          <span className={styles.barStart}>
            {withBack && back}
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
            {listen}
            {props.speechState !== 'idle' && (
              <RoundButton icon={Square} label={t('speech.stopLabel')} size={barSize} onClick={props.onStopSpeech} />
            )}
            <ShareMenu url={item.link} title={item.title} size={barSize} />
            <SiteButton link={item.link} size={barSize} />
          </span>
        </div>
        {/* From the start: a short text, all on screen, never scrolls and shows it full at once. */}
        {readable && <ReadingBar target={contentRef} />}
      </div>
      {header}
      {body}
    </article>
  )
}
