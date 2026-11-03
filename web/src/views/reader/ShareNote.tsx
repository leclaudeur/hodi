import { Trans, useTranslation } from 'react-i18next'
import { REACTIONS } from '../../api.ts'
import { shortAgo } from '../../lib/format.ts'
import { useProfiles } from '../../lib/profiles.ts'
import { reactTo, useShareOf } from '../../lib/shares.ts'
import ProfileAvatar from '../../ui/ProfileAvatar.tsx'
import styles from './ShareNote.module.css'

const useShare = (articleId: string) => {
  const entry = useShareOf(articleId)
  const household = useProfiles({ onError: () => {} })
  const from = entry && household?.profiles.find(profile => profile.id === entry.from)
  return entry && from ? { entry, from } : null
}

// A shared article or video: who sent it, and their word, above it, as wide as the text.
export const ShareNote = ({ articleId, className }: { articleId: string; className?: string }) => {
  const { t } = useTranslation()
  const share = useShare(articleId)
  if (!share) return null
  const { entry, from } = share
  const video = entry.item.kind === 'video' || entry.item.kind === 'podcast'
  return (
    <section className={`${styles.note} ${className ?? ''}`} aria-label={t('share.sentBy', { name: from.name })}>
      <ProfileAvatar profile={from} size={32} />
      <div className={styles.noteText}>
        <p className={styles.who}>
          <span>
            <Trans
              i18nKey={video ? 'share.sentYouVideo' : 'share.sentYouArticle'}
              values={{ name: from.name }}
              components={{ b: <b /> }}
            />
          </span>
          <span className={`${styles.when} mono`}>{shortAgo(new Date(entry.sharedAt).toISOString())}</span>
        </p>
        {entry.note && <p className={styles.quote}>{entry.note}</p>}
      </div>
    </section>
  )
}

// After the article, as a comment: an emoji back to whoever sent it. Touched again, it is taken back.
export const ShareReply = ({ articleId, className }: { articleId: string; className?: string }) => {
  const { t } = useTranslation()
  const share = useShare(articleId)
  if (!share) return null
  const { entry, from } = share
  return (
    <section className={`${styles.reply} ${className ?? ''}`} aria-label={t('share.opinionFor', { name: from.name })}>
      <p className={styles.who}>
        <ProfileAvatar profile={from} size={28} />
        <span>
          <Trans i18nKey="share.opinion" values={{ name: from.name }} components={{ b: <b /> }} />
        </span>
      </p>
      <div className={styles.reactions} role="group" aria-label={t('share.reactFor', { name: from.name })}>
        {REACTIONS.map(reaction => (
          <button
            key={reaction}
            type="button"
            className={styles.reaction}
            aria-pressed={entry.reaction === reaction}
            onClick={() => void reactTo(entry, entry.reaction === reaction ? null : reaction)}
          >
            {reaction}
          </button>
        ))}
      </div>
    </section>
  )
}
