import { Sparkle } from 'lucide-react'
import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { type Profile, profilePhotoUrl } from '../api.ts'
import { avatarUrl } from '../lib/avatars.ts'
import { claimCelebration, useGameNews, useProfileGame } from '../lib/game.ts'
import { useCurrentProfile } from '../lib/profiles.ts'
import BadgeIcon from './BadgeIcon.tsx'
import styles from './ProfileAvatar.module.css'

interface ProfileAvatarProps {
  profile: Pick<Profile, 'id' | 'name' | 'color' | 'photoVersion'> & Partial<Pick<Profile, 'avatar'>>
  // Its whole width, ring included.
  size: number
  // A photo picked but not sent yet.
  preview?: string | null
  // Without the game's ring and badge: the profile's form, "Qui lit ?".
  plain?: boolean
}

// Under this size a badge's drawing is no longer readable: the ring alone shows the level.
const BADGE_MIN_SIZE = 44
const TIERS = ['', 'bronze', 'silver', 'gold'] as const
// The celebration: a new level fills the ring and brings it back; then the sparkle lands with its burst.
const CELEBRATION_MS = 3200
// The burst of colours around the new sparkle: the app's colours, as the confetti's.
const SPARKS = [
  '--rust',
  '--topic-belgique',
  '--topic-monde',
  '--topic-tech',
  '--topic-science',
  '--topic-jeux-video',
  '--ai'
]
const SPARK_COUNT = 10
// An even size in an even pin: centred on whole pixels, not half ones.
const iconSize = (pin: number) => 2 * Math.round(pin * 0.3)

// The value shown: 0 on the first paint, then the target a frame later, so that the ring's transition runs from
// empty. Two frames: in the first, the empty ring is not drawn yet and the browser would skip the transition.
const useFilling = (target: number) => {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setShown(target))
    })
    return () => cancelAnimationFrame(frame)
  }, [target])
  return shown
}

// A profile's photo, its drawn avatar (a child) or its initial, in a circle ringed in its colour: as À la une's
// stories. With the household game on, the ring fills up to the next level, and the badge the profile chose sits
// at its foot.
const ProfileAvatar = ({ profile, size, preview, plain = false }: ProfileAvatarProps) => {
  const drawn = profile.avatar ? avatarUrl(profile.avatar) : null
  const photo = drawn ?? (preview === undefined ? profilePhotoUrl(profile as Profile) : preview)
  const state = useProfileGame(plain ? null : profile.id)
  const game = state === 'loading' ? null : state
  // The ring starts empty and fills up to the level's progress, then follows it.
  const progress = useFilling(game?.progress ?? 0)
  // A new level or badge of the profile in use, not yet seen on its sheet: a sparkle in the badge's place.
  const current = useCurrentProfile()
  const fresh = useGameNews(!plain && current?.id === profile.id)
  const arrived = fresh?.arrived ?? 0
  const [celebrating, setCelebrating] = useState(false)
  // The sparkle already there when more news arrives: it stays put and only bursts again.
  const sparkled = useRef(false)
  const [again, setAgain] = useState(false)
  // Before the first paint with the news: a frame later, the sparkle showed at full size for a moment, then vanished
  // to come in with its animation.
  useLayoutEffect(() => {
    if (!arrived) return
    // The first avatars on screen with it: one mounted after them shows the sparkle alone.
    setAgain(sparkled.current)
    setCelebrating(claimCelebration(arrived))
    const end = setTimeout(() => setCelebrating(false), CELEBRATION_MS)
    return () => clearTimeout(end)
  }, [arrived])
  // After the effect above, so that it reads whether the sparkle showed before this news.
  useEffect(() => {
    sparkled.current = fresh !== null
  })
  // A big avatar's ring thicker, as on its sheet.
  const stroke = size >= 64 ? 3 : 2
  const radius = size / 2 - stroke / 2
  const circumference = 2 * Math.PI * radius
  const badge = game?.badge && size >= BADGE_MIN_SIZE ? game.badge : null
  // Half the avatar, so it keeps its place at every size: 22 on the header's 44, 36 on the sheet's 72. Even, so the
  // icon centres on whole pixels.
  const pin = 2 * Math.round(size / 4)
  // The pin's centre on the ring, at the bottom right: it sits astride the circle, half outside it.
  const pinOffset = Math.round(size * (0.5 - Math.SQRT1_2 / 2) - pin / 2)
  return (
    <span
      className={styles.avatar}
      data-topic={profile.color}
      data-game={state ? '' : undefined}
      // A new level fills the ring (it shows the points); a badge alone only swaps the pin for the sparkle.
      data-celebrating={celebrating ? (fresh?.news.level ? 'level' : 'badge') : undefined}
      data-again={celebrating && again ? '' : undefined}
      style={{ width: size, height: size, '--pin-offset': `${pinOffset}px` } as CSSProperties}
      aria-hidden="true"
    >
      <span className={`${styles.face} ${drawn ? styles.drawn : ''}`} style={{ fontSize: Math.round(size * 0.38) }}>
        {photo ? (
          <img src={photo} alt="" width={size} height={size} />
        ) : (
          <span className={styles.initial}>{(profile.name.trim()[0] ?? '?').toUpperCase()}</span>
        )}
      </span>
      {state && (
        <svg className={styles.ring} width={size} height={size} viewBox={`0 0 ${size} ${size}`} strokeWidth={stroke}>
          <circle className={styles.track} cx={size / 2} cy={size / 2} r={radius} />
          {game && (
            <circle
              className={styles.progress}
              // Hidden at 0: its round end would draw a dot.
              opacity={progress > 0 || celebrating ? 1 : 0}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - progress)}
              style={
                {
                  '--offset': `${circumference * (1 - progress)}px`,
                  '--empty': `${circumference}px`,
                  '--emptied': `${-circumference}px`
                } as CSSProperties
              }
            />
          )}
        </svg>
      )}
      {/* The badge worn draws back while the ring celebrates; the sparkle then takes its place. */}
      {celebrating && !again && badge && (
        <span
          className={`${styles.pin} ${styles.leaving}`}
          data-tier={TIERS[badge.tier]}
          style={{ width: pin, height: pin }}
        >
          <BadgeIcon id={badge.id} size={iconSize(pin)} />
        </span>
      )}
      {fresh && size >= BADGE_MIN_SIZE ? (
        <span className={`${styles.pin} ${styles.fresh}`} style={{ width: pin, height: pin }}>
          <Sparkle size={iconSize(pin)} fill="currentColor" strokeWidth={1.5} />
          {/* As the sparkle comes in, a burst of colours from its centre. */}
          {celebrating && (
            <span className={styles.burst} aria-hidden="true">
              {Array.from({ length: SPARK_COUNT }, (_, index) => (
                <i
                  key={index}
                  style={
                    {
                      '--angle': `${(360 / SPARK_COUNT) * index + (index % 2) * 12}deg`,
                      '--from': `${pin / 2}px`,
                      '--distance': `${pin * (index % 2 ? 1.1 : 1.5)}px`,
                      '--color': `var(${SPARKS[index % SPARKS.length]})`
                    } as CSSProperties
                  }
                />
              ))}
            </span>
          )}
        </span>
      ) : (
        badge && (
          <span className={styles.pin} data-tier={TIERS[badge.tier]} style={{ width: pin, height: pin }}>
            <BadgeIcon id={badge.id} size={iconSize(pin)} />
          </span>
        )
      )}
    </span>
  )
}

export default ProfileAvatar
