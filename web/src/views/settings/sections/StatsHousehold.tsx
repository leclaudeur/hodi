import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Profile } from '../../../api.ts'
import { useHouseholdGame } from '../../../lib/game.ts'
import { useProfiles } from '../../../lib/profiles.ts'
import ProfileAvatar from '../../../ui/ProfileAvatar.tsx'
import ProfileSheet from '../../../ui/ProfileSheet.tsx'
import statStyles from './StatsSection.module.css'
import styles from './StatsHousehold.module.css'

// The household game's week, above the profile's own stats: the challenge read together, then who earned most.
// Nothing while the game is off.
const StatsHousehold = () => {
  const { t } = useTranslation()
  const game = useHouseholdGame()
  const profiles = useProfiles()?.profiles ?? []
  const [open, setOpen] = useState<Profile | null>(null)
  if (!game) return null

  const { goal, read, reached } = game.challenge
  const ranked = game.ranking.flatMap(entry => {
    const profile = profiles.find(candidate => candidate.id === entry.profileId)
    return profile ? [{ entry, profile }] : []
  })

  return (
    <>
      <div className={statStyles.subtitle}>
        <h2 className={statStyles.subtitleText}>{t('game.yourHousehold')}</h2>
        <span className={statStyles.subtitleNote}>{t('game.thisWeek')}</span>
      </div>
      <section className={statStyles.card} aria-labelledby="stats-household">
        <div>
          <h2 id="stats-household" className={statStyles.cardTitle}>
            {t('game.challenge')}
          </h2>
          <p className={statStyles.cardIntro}>
            {reached
              ? t('game.challengeReached', { read, goal })
              : t(profiles.length > 1 ? 'game.challengeTogether' : 'game.challengeAlone', {
                  count: read,
                  goal,
                  profiles: profiles.length
                })}
          </p>
        </div>
        <div className={statStyles.split} aria-hidden="true">
          <span className={statStyles.splitRead} style={{ width: `${Math.min(1, read / goal) * 100}%` }} />
          {read < goal && <span className={statStyles.splitSkimmed} style={{ flex: 1 }} />}
        </div>
        <ol className={styles.ranking}>
          {ranked.map(({ entry, profile }, index) => (
            <li key={profile.id}>
              <button
                type="button"
                className={styles.row}
                aria-label={t('game.rankLabel', {
                  rank: index + 1,
                  name: profile.name,
                  grade: entry.name,
                  count: entry.week
                })}
                onClick={() => setOpen(profile)}
              >
                <span className={styles.rank} data-first={index === 0 && entry.week > 0 ? '' : undefined}>
                  {index + 1}
                </span>
                <ProfileAvatar profile={profile} size={44} />
                <span className={styles.text}>
                  <span className={styles.name}>{profile.name}</span>
                  <span className={styles.meta}>{entry.name}</span>
                </span>
                <span className={styles.points}>
                  {entry.week} {t('game.pts')}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </section>
      <ProfileSheet profile={open} onClose={() => setOpen(null)} />
    </>
  )
}

export default StatsHousehold
