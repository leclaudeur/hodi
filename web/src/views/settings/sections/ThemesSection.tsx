import { GripVertical } from 'lucide-react'
import { type KeyboardEvent, type PointerEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TopicInfo } from '../../../api.ts'
import { hasShownSource, orderTopics, updatePreferences, usePreferences } from '../../../lib/preferences.ts'
import Toggle from '../../../ui/Toggle.tsx'
import TopicIcon from '../../../ui/TopicIcon.tsx'
import SectionPage from '../SectionPage.tsx'
import styles from '../Settings.module.css'
import themeStyles from './ThemesSection.module.css'

const moved = (ids: string[], from: number, to: number) => {
  const next = [...ids]
  const [id] = next.splice(from, 1)
  if (id !== undefined) next.splice(to, 0, id)
  return next
}

// While dragging: the order shown, saved once the topic is dropped. The arrow keys on a handle move it at once.
const useTopicDrag = (ids: string[]) => {
  const [dragging, setDragging] = useState<{ id: string; order: string[] } | null>(null)

  const startDrag = (event: PointerEvent<HTMLButtonElement>, id: string) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging({ id, order: ids })
  }

  const drag = (event: PointerEvent<HTMLButtonElement>) => {
    if (!dragging) return
    const row = document
      .elementsFromPoint(event.clientX, event.clientY)
      .find(element => element instanceof HTMLElement && element.dataset.topicRow)
    const over = row instanceof HTMLElement ? row.dataset.topicRow : undefined
    if (!over || over === dragging.id) return
    const from = dragging.order.indexOf(dragging.id)
    const to = dragging.order.indexOf(over)
    setDragging({ ...dragging, order: moved(dragging.order, from, to) })
  }

  const drop = () => {
    if (dragging) updatePreferences({ topicOrder: dragging.order })
    setDragging(null)
  }

  const moveWithKeys = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = KEY_STEPS.get(event.key) ?? 0
    if (!step || index + step < 0 || index + step >= ids.length) return
    event.preventDefault()
    updatePreferences({ topicOrder: moved(ids, index, index + step) })
    // The handle keeps the focus as its row moves.
    const target = event.currentTarget
    window.requestAnimationFrame(() => target.focus())
  }

  return { dragging, startDrag, drag, drop, moveWithKeys }
}

const KEY_STEPS = new Map([
  ['ArrowUp', -1],
  ['ArrowDown', 1]
])

interface ThemeRowProps {
  topic: TopicInfo
  index: number
  hiddenTopics: string[]
  drag: ReturnType<typeof useTopicDrag>
}

// A topic: its handle, its icon, its name over its count, its switch.
const ThemeRow = ({ topic, index, hiddenTopics, drag }: ThemeRowProps) => {
  const { t } = useTranslation()
  const hidden = hiddenTopics.includes(topic.id)
  return (
    <li
      className={`${styles.row} ${themeStyles.row} ${drag.dragging?.id === topic.id ? themeStyles.dragged : ''}`}
      data-topic-row={topic.id}
    >
      <button
        type="button"
        className={themeStyles.handle}
        aria-label={t('settings.themes.move', { name: topic.label })}
        onPointerDown={event => drag.startDrag(event, topic.id)}
        onPointerMove={drag.drag}
        onPointerUp={drag.drop}
        onPointerCancel={drag.drop}
        onKeyDown={event => drag.moveWithKeys(event, index)}
      >
        <GripVertical size={16} aria-hidden="true" />
      </button>
      <span className={`${themeStyles.icon} ${hidden ? styles.dim : ''}`} data-topic={topic.id}>
        <TopicIcon topicId={topic.id} size={18} />
      </span>
      {/* The count under the name: a long name keeps one line on a phone. */}
      <span className={styles.rowText}>
        <span className={`${styles.rowLabel} ${themeStyles.name} ${hidden ? themeStyles.hidden : ''}`}>
          {topic.label}
        </span>
        <span className={styles.mono}>
          {t('count.source', { count: topic.sources.length })}
          {hidden && ` · ${t('settings.themes.hidden')}`}
        </span>
      </span>
      <Toggle
        label={t('settings.themes.show', { name: topic.label })}
        checked={!hidden}
        onChange={show =>
          updatePreferences({
            hiddenTopics: show ? hiddenTopics.filter(other => other !== topic.id) : [...hiddenTopics, topic.id]
          })
        }
      />
    </li>
  )
}

interface ThemesSectionProps {
  topics: TopicInfo[]
  layout: 'desktop' | 'phone'
}

// The topics' order (dragged by their handle, or moved with the arrow keys on it) and which ones show.
const ThemesSection = ({ topics, layout }: ThemesSectionProps) => {
  const { t } = useTranslation()
  const preferences = usePreferences()
  // Every topic with a source to show, hidden ones included, in the tabs' order.
  const ordered = orderTopics(topics, { ...preferences, hiddenTopics: [] }).filter(topic =>
    hasShownSource(topic, preferences)
  )
  const ids = ordered.map(topic => topic.id)
  const drag = useTopicDrag(ids)
  const shown = (drag.dragging?.order ?? ids)
    .map(id => ordered.find(topic => topic.id === id))
    .filter(Boolean) as TopicInfo[]

  return (
    <SectionPage title={t('settings.nav.themes')} intro={t('settings.themes.intro')} layout={layout}>
      <ol className={styles.card}>
        {shown.map((topic, index) => (
          <ThemeRow key={topic.id} topic={topic} index={index} hiddenTopics={preferences.hiddenTopics} drag={drag} />
        ))}
      </ol>
    </SectionPage>
  )
}

export default ThemesSection
