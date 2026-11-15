import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { type MouseEvent, useEffect, useRef, useState } from 'react'
import type { ResumeEntry } from '../api.ts'
import { useReadableOffline } from '../lib/offline.ts'
import { resumeFrom, setAsideResume, useResumeEntries } from '../lib/resume.ts'
import ArticleCard from '../ui/ArticleCard.tsx'
import DaySeparator from '../ui/DaySeparator.tsx'
import RoundButton, { CARD_BUTTON } from '../ui/RoundButton.tsx'
import styles from './ResumePile.module.css'

// The front card leaves this long, while the next one comes forward.
const LEAVE_MS = 260
// Cards drawn: the front one, and two edges under it.
const SHOWN = 3

interface ResumePileProps {
  layout: 'desktop' | 'phone'
  // The article open beside the list (desktop): not offered while it is read.
  activeId?: string | null
}

interface PileCardProps {
  entry: ResumeEntry
  layout: 'desktop' | 'phone'
  onRemove: (event: MouseEvent) => void
  onOpen: () => void
}

// A card of the pile: the time left to read and a cross to put it away.
const PileCard = ({ entry, layout, onRemove, onOpen }: PileCardProps) => {
  const { t } = useTranslation()
  return (
    <ArticleCard
      item={entry.item}
      variant={layout === 'desktop' ? 'row' : 'compact'}
      plain
      note={<span className={styles.left}>{t('resume.left', { count: entry.minutesLeft })}</span>}
      action={<RoundButton icon={X} label={t('resume.remove')} size={28} className={CARD_BUTTON} onClick={onRemove} />}
      onOpen={onOpen}
    />
  )
}

// "Reprendre", on top of Le fil (its list asks for it with useResume): the articles started and left, newest first, piled like notifications.
// Its cross or opening it sends the front card away; the last one goes at once.
const ResumePile = ({ layout, activeId = null }: ResumePileProps) => {
  const { t } = useTranslation()
  const entries = useResumeEntries()
  const readable = useReadableOffline()
  const [gone, setGone] = useState<string[]>([])
  const [leaving, setLeaving] = useState<{ id: string; height: number } | null>(null)
  const front = useRef<HTMLDivElement>(null)
  const timer = useRef(0)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const shown = entries.filter(
    entry =>
      readable(entry.item) &&
      !gone.includes(entry.item.id) &&
      (entry.item.id !== activeId || entry.item.id === leaving?.id)
  )
  if (shown.length === 0) return null

  const leave = (id: string) => {
    if (leaving) return
    if (shown.length === 1) {
      setGone(ids => [...ids, id])
      return
    }
    setLeaving({ id, height: front.current?.offsetHeight ?? 0 })
    timer.current = window.setTimeout(() => {
      setGone(ids => [...ids, id])
      setLeaving(null)
    }, LEAVE_MS)
  }

  const open = (entry: ResumeEntry) => {
    resumeFrom(entry.item.id, entry.position)
    leave(entry.item.id)
  }

  const putAway = (event: MouseEvent, id: string) => {
    // Cards are links: the cross must not open the article.
    event.preventDefault()
    event.stopPropagation()
    setAsideResume(id)
    leave(id)
  }

  // The leaving card keeps its place on top while the others move forward under it.
  const stacked = shown.filter(entry => entry.item.id !== leaving?.id)
  const count = stacked.length

  return (
    <section className={`${styles.pile} ${styles[layout]}`} aria-label={t('resume.title')}>
      <DaySeparator label={t('resume.title')} count={count} still first />
      <div className={styles.cards}>
        {shown.slice(0, SHOWN + 1).map(entry => {
          const isLeaving = entry.item.id === leaving?.id
          const depth = isLeaving ? 0 : Math.min(stacked.indexOf(entry), SHOWN)
          return (
            <div
              key={entry.item.id}
              ref={depth === 0 && !isLeaving ? front : undefined}
              className={`${styles.card} ${isLeaving ? styles.leaving : ''}`}
              data-depth={depth}
              style={isLeaving ? { height: leaving.height } : { zIndex: SHOWN + 1 - depth }}
              inert={depth > 0 || isLeaving}
            >
              <PileCard
                entry={entry}
                layout={layout}
                onRemove={event => putAway(event, entry.item.id)}
                onOpen={() => open(entry)}
              />
              <div className={styles.bar} aria-hidden="true">
                <span style={{ transform: `scaleX(${entry.progress})` }} />
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

export default ResumePile
