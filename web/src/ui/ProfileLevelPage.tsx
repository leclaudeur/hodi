import type { CSSProperties } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import type { ProfileGame } from '../api.ts'
import ProfileAvatar from './ProfileAvatar.tsx'
import { type SheetProfile, points } from './profile-sheet-game.ts'
import styles from './ProfileSheet.module.css'

// The burst around the avatar as its ring closes: the app's colours, as the confetti's.
const SPARKS = [
  '--rust',
  '--topic-belgium',
  '--topic-world',
  '--topic-tech',
  '--topic-science',
  '--topic-gaming',
  '--ai'
]
const SPARK_COUNT = 16
// When the ring and the bar are full: the grade changes, the burst and the confetti go off (as in the CSS).
export const LEVEL_FULL_MS = 1300

// The new grade: the avatar's ring and the bar from the grade before fill to the brim; then the level and the grade
// change in place, with a burst around the avatar and confetti.
const LevelPage = ({ profile, game }: { profile: SheetProfile; game: ProfileGame }) => {
  const { t } = useTranslation()
  const previous = game.previous
  return (
    <div className={styles.party} data-topic={profile.color}>
      <span className={styles.partyAvatar}>
        <ProfileAvatar profile={profile} size={104} plain />
        {/* In place of the avatar's own ring, as every avatar's: its track and the level filling it. */}
        <svg className={styles.partyRing} viewBox="0 0 104 104" aria-hidden="true">
          <circle className={styles.partyTrack} cx="52" cy="52" r="50.5" />
          <circle className={styles.partyArc} cx="52" cy="52" r="50.5" />
        </svg>
        <span className={styles.partyBurst} aria-hidden="true">
          {Array.from({ length: SPARK_COUNT }, (_, index) => (
            <i
              key={index}
              style={
                {
                  '--angle': `${(360 / SPARK_COUNT) * index + (index % 2) * 8}deg`,
                  '--distance': `${index % 2 ? 72 : 84}px`,
                  '--color': `var(${SPARKS[index % SPARKS.length]})`
                } as CSSProperties
              }
            />
          ))}
        </span>
      </span>
      {/* The level and the grade before, then in their place the new ones. */}
      <span className={`${styles.meta} ${styles.flip}`}>
        {previous && (
          <span className={styles.before} aria-hidden="true">
            {t('game.levelN', { level: game.level - 1 })}
          </span>
        )}
        <span className={styles.after}>{t('game.levelN', { level: game.level })}</span>
      </span>
      <span className={`${styles.partyTitle} ${styles.flip}`}>
        {previous && (
          <span className={styles.before} aria-hidden="true">
            {previous.name}
          </span>
        )}
        <span className={styles.after}>{game.name}</span>
      </span>
      {previous && (
        <span className={styles.partyLevel} aria-hidden="true">
          <span className={styles.grades}>
            <span className={styles.partyFrom}>{previous.name}</span>
            <span className={styles.partyTo}>{game.name}</span>
          </span>
          <span className={styles.bar}>
            <span className={`${styles.fill} ${styles.partyFill}`} />
          </span>
        </span>
      )}
      <p className={styles.partyText}>
        <Trans
          i18nKey={game.next ? 'game.gradeText' : 'game.gradeTop'}
          values={{ name: game.name, next: game.next?.name, points: points((game.next?.points ?? 0) - game.points) }}
          components={{ b: <b /> }}
        />
      </p>
    </div>
  )
}

export default LevelPage
