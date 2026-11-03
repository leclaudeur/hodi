import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import type { ShareReaction } from '../api.ts'
import { shortAgo } from '../lib/format.ts'
import { useProfiles } from '../lib/profiles.ts'
import { seeShareReactions, useShareReactions } from '../lib/shares.ts'
import { articleHref, watchHref } from '../lib/use-hash-route.ts'
import ProfileAvatar from '../ui/ProfileAvatar.tsx'
import RoundButton from '../ui/RoundButton.tsx'
import styles from '../ui/NoticeRows.module.css'

const same = (a: ShareReaction, b: ShareReaction) => a.item.id === b.item.id && a.to === b.to

// "Léa a réagi ❤️": the reactions to what this profile sent, above "Partages". Shown once: the server forgets
// them as soon as they are here, the cross takes one away at once.
// A profile picked in the filters: only its reactions.
const ShareReactions = ({ layout, from = null }: { layout: 'desktop' | 'phone'; from?: number | null }) => {
  const { t } = useTranslation()
  const found = useShareReactions()
  // Kept while "Partages" is open, even once the server forgot them.
  const [items, setItems] = useState(found)
  const [merged, setMerged] = useState(found)
  if (merged !== found) {
    setMerged(found)
    setItems([...found.filter(entry => !items.some(other => same(other, entry))), ...items])
  }
  const household = useProfiles({ onError: () => {} })

  useEffect(() => {
    if (found.length > 0) seeShareReactions(Math.max(...found.map(entry => entry.reactedAt)))
  }, [found])

  const shown = items.filter(
    entry => (from === null || entry.to === from) && household?.profiles.some(profile => profile.id === entry.to)
  )
  if (shown.length === 0) return null

  return (
    <section className={`${styles.reactions} ${styles[layout]}`} aria-label={t('shares.reactions')}>
      {shown.map(entry => {
        const to = household?.profiles.find(profile => profile.id === entry.to)
        if (!to) return null
        const video = entry.item.kind === 'video' || entry.item.kind === 'podcast'
        return (
          <div key={`${entry.item.id}:${entry.to}`} className={styles.row}>
            <a className={styles.link} href={video ? watchHref(entry.item.id) : articleHref(entry.item.id)}>
              <ProfileAvatar profile={to} size={28} />
              <span className={styles.text}>
                <span>
                  <Trans
                    i18nKey="shares.reacted"
                    values={{ name: to.name, reaction: entry.reaction }}
                    components={{ b: <b /> }}
                  />
                </span>
                <span className={styles.title}>{entry.item.title}</span>
              </span>
              <span className={`${styles.when} mono`}>{shortAgo(new Date(entry.reactedAt).toISOString())}</span>
            </a>
            <RoundButton
              icon={X}
              label={t('shares.dismiss')}
              size={34}
              onClick={() => setItems(items.filter(other => other !== entry))}
            />
          </div>
        )
      })}
    </section>
  )
}

export default ShareReactions
