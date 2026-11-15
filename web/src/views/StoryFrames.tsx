import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { type PointerEvent, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FrontPageSection, TopicItem } from '../api.ts'
import { useArticleImage } from '../lib/article-image.ts'
import { fadeIn } from '../lib/fade-in.ts'
import { FRONT_PAGE_HREF } from '../lib/use-hash-route.ts'
import { useMedia } from '../lib/use-media.ts'
import BookmarkButton from '../ui/BookmarkButton.tsx'
import ReadPill from '../ui/ReadPill.tsx'
import RoundButton from '../ui/RoundButton.tsx'
import SourceAvatar from '../ui/SourceAvatar.tsx'
import TopicCapsule from '../ui/TopicCapsule.tsx'
import styles from './StoryViewer.module.css'

// Back to the list, as the phone's cross; Échap does the same.
// A story full screen on a phone: the page under it does not scroll with the finger.
export const useLockedPage = (locked: boolean) =>
  useEffect(() => {
    if (!locked) return
    document.documentElement.toggleAttribute('data-story', true)
    return () => {
      document.documentElement.toggleAttribute('data-story', false)
    }
  }, [locked])

export const CloseStories = () => {
  const { t } = useTranslation()
  return (
    <RoundButton
      icon={X}
      label={t('common.close')}
      size={44}
      data-shortcut="back"
      onClick={() => (window.location.hash = FRONT_PAGE_HREF)}
    />
  )
}

// The arrow keys turn the stories, as the arrows on the page.
export const useArrowKeys = (next: () => void, previous: () => void) =>
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') next()
      else if (event.key === 'ArrowLeft') previous()
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  })

// On a phone, each story stays this long, then the next one comes (not with reduced motion).
const STORY_MS = 7000

// A story's picture, at the width it takes. One that doesn't load leaves the place plain, not a broken image.
const StoryImage = ({
  item,
  sizes,
  className,
  fade = false
}: {
  item: TopicItem
  sizes: string
  className?: string
  fade?: boolean
}) => {
  const image = useArticleImage(item.id, item.image, sizes)
  if (!image) return null
  return <img {...(fade ? fadeIn(className) : { className })} {...image} alt="" decoding="async" />
}

export interface StoryFrameProps {
  section: FrontPageSection
  item: TopicItem
  // The story's place in its topic.
  index: number
  // How long ago it was published, in capitals.
  age: string | undefined
  open: () => void
  next: () => void
  previous: () => void
}

// On a computer: the story in the page, with its arrows and count above it.
export const DesktopStory = ({
  section,
  item,
  index,
  age,
  open,
  next,
  previous,
  hasPrevious
}: StoryFrameProps & { hasPrevious: boolean }) => {
  const { t } = useTranslation()
  return (
    <div className={styles.desktop} data-topic={section.id}>
      <div className={styles.header}>
        <span className={styles.kicker}>
          {t('stories.headlines')} · <span className={styles.topic}>{section.label}</span>
        </span>
        {/* Beside the count, on the page: legible whatever the picture. 44, as in the daily summary's row: nothing
            jumps from one to the other. */}
        <span className={styles.tools}>
          <span className={styles.stepper}>
            <RoundButton
              icon={ChevronLeft}
              label={t('stories.previous')}
              size={44}
              onClick={previous}
              disabled={!hasPrevious}
            />
            <span className={styles.count}>
              {index + 1} / {section.items.length}
            </span>
            <RoundButton icon={ChevronRight} label={t('stories.next')} size={44} onClick={next} />
          </span>
          <CloseStories />
        </span>
      </div>
      <div className={styles.bars} aria-hidden="true">
        {section.items.map((story, storyIndex) => (
          <span key={story.id} className={`${styles.bar} ${storyIndex <= index ? styles.done : ''}`} />
        ))}
      </div>
      <figure className={styles.figure}>
        <StoryImage key={item.id} item={item} sizes="(max-width: 640px) 100vw, 640px" fade />
        <figcaption className={styles.caption}>
          <h2 className={styles.title}>{item.title}</h2>
        </figcaption>
      </figure>
      {item.summary && <p className={styles.summary}>{item.summary}</p>}
      <div className={styles.meta}>
        <span className={styles.source}>
          <SourceAvatar sourceId={item.sourceId} sourceName={item.sourceName} />
          {item.sourceName}
          {age && (
            <>
              {' · '}
              <span className={styles.age}>{age}</span>
            </>
          )}
        </span>
        <span className={styles.actions}>
          <BookmarkButton item={item} variant="round" />
          <ReadPill item={item} onOpen={open} />
        </span>
      </div>
    </div>
  )
}

// On a phone: full screen over its picture, a bar running per story.
export const PhoneStory = ({ section, item, index, age, open, next, previous }: StoryFrameProps) => {
  const { t } = useTranslation()
  const reducedMotion = useMedia('(prefers-reduced-motion: reduce)')
  const [held, setHeld] = useState(false)
  // When the finger went down, to tell a tap from a hold.
  const pressedAt = useRef(0)

  // Holding a finger pauses; a tap on the left third goes back, anywhere else goes on.
  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    setHeld(false)
    if (event.timeStamp - pressedAt.current > 300) return
    const { left, width } = event.currentTarget.getBoundingClientRect()
    if (event.clientX - left < width / 3) previous()
    else next()
  }

  return (
    <div
      className={styles.phone}
      data-topic={section.id}
      role="dialog"
      aria-modal="true"
      aria-label={t('stories.of', { topic: section.label })}
    >
      <StoryImage key={item.id} item={item} sizes="100vw" className={styles.backdrop} />
      <div
        className={styles.tapArea}
        onPointerDown={event => {
          pressedAt.current = event.timeStamp
          setHeld(true)
        }}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => setHeld(false)}
        aria-hidden="true"
      />
      <div className={styles.top}>
        <div className={styles.phoneBars} aria-hidden="true">
          {section.items.map((story, storyIndex) => (
            <span key={story.id} className={styles.phoneBar}>
              {storyIndex < index && <span className={styles.fill} />}
              {storyIndex === index && (
                <span
                  key={`${section.id}-${index}`}
                  className={`${styles.fill} ${reducedMotion ? '' : styles.running}`}
                  style={{ animationDuration: `${STORY_MS}ms`, animationPlayState: held ? 'paused' : 'running' }}
                  onAnimationEnd={reducedMotion ? undefined : next}
                />
              )}
            </span>
          ))}
        </div>
        <div className={styles.topRow}>
          <span className={styles.phoneSource}>
            <SourceAvatar sourceId={item.sourceId} sourceName={item.sourceName} size={26} />
            {item.sourceName}
          </span>
          <a className={styles.close} href={FRONT_PAGE_HREF} aria-label={t('common.close')} data-shortcut="back">
            <X size={18} aria-hidden="true" />
          </a>
        </div>
      </div>
      <div className={styles.bottom}>
        {/* A capsule, as everywhere else: its dark fill keeps it readable on any photo. */}
        <span className={styles.phoneTopic}>
          <TopicCapsule topicId={section.id} label={section.label} href={null} />
        </span>
        <h2 className={styles.phoneTitle}>{item.title}</h2>
        {item.summary && <p className={styles.phoneSummary}>{item.summary}</p>}
        {age && <span className={styles.age}>{t('stories.published', { age })}</span>}
        <div className={styles.phoneActions}>
          <ReadPill item={item} size={44} onOpen={open} />
          <BookmarkButton item={item} variant="round" size={44} />
        </div>
      </div>
    </div>
  )
}
