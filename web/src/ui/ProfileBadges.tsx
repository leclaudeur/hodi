import { Check, Lock, Star } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { BadgeId, BadgeProgress, BadgeTier, ProfileGame } from '../api.ts'
import BadgeIcon from './BadgeIcon.tsx'
import { TIERS, points } from './profile-sheet-game.ts'
import styles from './ProfileSheet.module.css'
import { Bar } from './Skeleton.tsx'

// Six grey cards while the badges come, so the sheet opens at its height rather than growing under the eye.
export const BadgesSkeleton = () => (
  <ul className={styles.badges} aria-hidden="true">
    {Array.from({ length: 6 }, (_, index) => (
      <li key={index}>
        <span className={styles.card}>
          <Bar width={44} height={44} radius={12} />
          <span className={styles.label}>
            <Bar width={64} height={12} />
          </span>
          <Bar width={40} height={10} />
        </span>
      </li>
    ))}
  </ul>
)

// Lucide's star outline, for a reached tier drawn in metal.
const STAR_PATH =
  'M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z'

// A tier's star: empty until reached, then in its tier's metal, a light across it and a darker edge.
const TierStar = ({ step, reached, size }: { step: 1 | 2 | 3; reached: boolean; size: number }) => {
  const gradientId = useId()
  if (!reached) return <Star size={size} strokeWidth={2} className={styles.star} aria-hidden="true" />
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={`${styles.star} ${styles.metal}`}
      data-tier={TIERS[step]}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" className={styles.metalHigh} />
          <stop offset="0.38" className={styles.metalLight} />
          <stop offset="0.5" className={styles.metalBase} />
          <stop offset="0.56" className={styles.metalDeep} />
          <stop offset="0.8" className={styles.metalSoft} />
          <stop offset="1" className={styles.metalEnd} />
        </linearGradient>
      </defs>
      <path d={STAR_PATH} fill={`url(#${gradientId})`} />
    </svg>
  )
}

// The three tiers as stars, each in its tier's metal once reached.
export const Stars = ({ tier, size }: { tier: BadgeTier; size: number }) => {
  const { t } = useTranslation()
  return (
    <span className={styles.stars} role="img" aria-label={t('game.stars', { count: tier })}>
      {([1, 2, 3] as const).map(step => (
        <TierStar key={step} step={step} reached={step <= tier} size={size} />
      ))}
    </span>
  )
}

// A badge's page: its medal, its rule, and its three tiers with how far the next one is.
// shine: a light crosses the medal, bright as the badge is just won, softer on an earned badge opened from the list.
export const BadgeDetail = ({ badge, shine }: { badge: BadgeProgress; shine?: 'won' | 'earned' }) => {
  const { t } = useTranslation()
  const unit = (count: number) => t(`game.badges.${badge.id}.unit`, { count })
  const reached = badge.tier
  return (
    <div className={styles.detail} data-tier={TIERS[badge.tier] || undefined}>
      <span
        className={`${styles.medal} ${shine ? styles.shine : ''}`}
        data-tier={TIERS[badge.tier] || undefined}
        data-shine={shine}
      >
        <BadgeIcon id={badge.id} size={48} />
      </span>
      <span className={styles.detailName}>{badge.name}</span>
      <Stars tier={badge.tier} size={20} />
      <p className={styles.rule}>{t(`game.badges.${badge.id}.text`)}</p>
      <ol className={styles.tierList}>
        {badge.tiers.map((needed, index) => {
          const step = (index + 1) as 1 | 2 | 3
          return (
            <li key={step} data-reached={step <= reached ? '' : undefined}>
              <TierStar step={step} reached={step <= reached} size={16} />
              <span className={styles.tierName}>{t(`game.tiers.${step}`)}</span>
              {/* The tier being earned shows how far it is; the others what they need. */}
              <span className={styles.tierNeeds}>
                {step === reached + 1 ? (
                  <>
                    <b>{points(badge.count)}</b> / {points(needed)} {unit(needed)}
                  </>
                ) : (
                  `${points(needed)} ${unit(needed)}`
                )}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

// A badge's card in the sheet's grid: its tile, its stars, its count, and whether it is worn or still locked.
const BadgeCard = ({ badge, worn, onOpen }: { badge: BadgeProgress; worn: boolean; onOpen: () => void }) => {
  const { t } = useTranslation()
  const earned = badge.tier > 0
  return (
    <button
      type="button"
      className={`${styles.card} ${earned ? '' : styles.locked}`}
      data-worn={worn ? '' : undefined}
      aria-label={t('game.open', { name: badge.name })}
      onClick={onOpen}
    >
      <span className={styles.tile} data-tier={TIERS[badge.tier] || undefined}>
        <BadgeIcon id={badge.id} />
      </span>
      <span className={styles.label}>{badge.name}</span>
      <Stars tier={badge.tier} size={12} />
      <span className={styles.meta}>
        {badge.next === null ? points(badge.count) : `${points(badge.count)} / ${points(badge.next)}`}
      </span>
      {(worn || !earned) && (
        <span className={styles.corner} data-worn={worn ? '' : undefined}>
          {worn ? <Check size={12} strokeWidth={3} /> : <Lock size={12} strokeWidth={2.5} />}
        </span>
      )}
    </button>
  )
}

// Earned badges first, then those still to earn (only on one's own sheet).
export const BadgeGrid = ({
  game,
  mine,
  onOpen
}: {
  game: ProfileGame
  mine: boolean
  onOpen: (badge: BadgeId) => void
}) => (
  <ul className={`${styles.badges} appear`}>
    {[
      ...game.badges.filter(badge => badge.tier > 0),
      ...(mine ? game.badges.filter(badge => badge.tier === 0) : [])
    ].map(badge => (
      <li key={badge.id}>
        <BadgeCard badge={badge} worn={game.badge?.id === badge.id} onOpen={() => onOpen(badge.id)} />
      </li>
    ))}
  </ul>
)
