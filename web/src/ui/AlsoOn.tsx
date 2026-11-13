import { Layers } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RelatedItem } from '../api.ts'
import { articleHref } from '../lib/use-hash-route.ts'
import styles from './ArticleCard.module.css'
import SourceAvatar from './SourceAvatar.tsx'

// The other sources on the same story: their avatars, and their list on a click.
const AlsoOn = ({ related, compact }: { related: RelatedItem[]; compact: boolean }) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const label = t('card.alsoOn', { count: related.length })

  if (compact)
    return (
      <span className={styles.alsoOnLine}>
        <Layers size={14} aria-hidden="true" />
        {label}
      </span>
    )

  return (
    <div className={styles.alsoOn}>
      <button type="button" className={styles.alsoOnButton} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Layers size={14} aria-hidden="true" />
        <span className={styles.alsoOnLabel}>{label}</span>
        <span className={styles.alsoOnAvatars} aria-hidden="true">
          {related.slice(0, 3).map(other => (
            <SourceAvatar key={other.id} sourceId={sourceIdOf(other)} sourceName={other.sourceName} />
          ))}
        </span>
      </button>
      {open && (
        <ul className={styles.alsoOnList}>
          {related.map(other => (
            <li key={other.id}>
              <a href={articleHref(other.id)}>
                <SourceAvatar sourceId={sourceIdOf(other)} sourceName={other.sourceName} />
                <span className={styles.alsoOnSource}>{other.sourceName}</span>
                <span className={styles.alsoOnTitle}>{other.title}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// Saved before related items had a source id: their initials show.
const sourceIdOf = (related: RelatedItem) => related.sourceId ?? ''

export default AlsoOn
