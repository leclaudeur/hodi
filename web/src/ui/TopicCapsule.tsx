import { topicHref } from '../lib/use-hash-route.ts'
import styles from './TopicCapsule.module.css'
import TopicIcon from './TopicIcon.tsx'

interface TopicCapsuleProps {
  topicId: string
  label: string
  // A link to the topic, or a filter that is on or off.
  href?: string | null
  selected?: boolean
  size?: 'small' | 'filter'
  onClick?: () => void
}

// A topic, always with its icon and name, never its colour alone.
const TopicCapsule = ({
  topicId,
  label,
  href = topicHref(topicId),
  selected = false,
  size = 'small',
  onClick
}: TopicCapsuleProps) => {
  const className = [styles.capsule, styles[size], selected ? styles.selected : ''].join(' ')
  const content = (
    <>
      <TopicIcon topicId={topicId} size={size === 'filter' ? 14 : 12} />
      {label}
    </>
  )

  if (onClick)
    return (
      <button type="button" className={className} data-topic={topicId} aria-pressed={selected} onClick={onClick}>
        {content}
      </button>
    )

  return href ? (
    <a className={className} data-topic={topicId} href={href} aria-current={selected ? 'page' : undefined}>
      {content}
    </a>
  ) : (
    <span className={className} data-topic={topicId}>
      {content}
    </span>
  )
}

export default TopicCapsule
