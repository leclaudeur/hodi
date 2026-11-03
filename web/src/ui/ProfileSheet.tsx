import { Check, Lock, Star } from 'lucide-react'
import { type CSSProperties, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import {
  type BadgeId,
  type GameNews,
  type BadgeProgress,
  type BadgeTier,
  type Profile,
  type ProfileGame,
  getMyGame,
  getProfileGame,
  wearBadge
} from '../api.ts'
import { hasNews, refreshGame, seeGameNews, useGameNews } from '../lib/game.ts'
import { getLanguage, t as textNow } from '../lib/i18n.ts'
import { useCurrentProfile } from '../lib/profiles.ts'
import { useIsDesktop } from '../lib/use-media.ts'
import { showError } from '../lib/toast.ts'
import { PROFILES_HREF } from '../lib/use-hash-route.ts'
import BadgeIcon from './BadgeIcon.tsx'
import Button from './Button.tsx'
import Confetti from './Confetti.tsx'
import Dialog from './Dialog.tsx'
import DialogActions from './DialogActions.tsx'
import ProfileAvatar from './ProfileAvatar.tsx'
import { Bar } from './Skeleton.tsx'
import styles from './ProfileSheet.module.css'

interface ProfileSheetProps {
  profile: Pick<Profile, 'id' | 'name' | 'color' | 'photoVersion'> | null
  onClose: () => void
}

// Each sheet as last loaded: opened again, it shows at once, at its size, and is brought up to date behind.
const loaded = new Map<number, ProfileGame>()

// Six grey cards while the badges come, so the sheet opens at its height rather than growing under the eye.
const BadgesSkeleton = () => (
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
const TIERS = ['', 'bronze', 'silver', 'gold'] as const

// What one's own sheet celebrates first, a page each, in the sheet's dialog: the new grade, then each new badge.
type PartyPage = { kind: 'level' } | { kind: 'badge'; id: BadgeId }

const pagesOf = (news: GameNews): PartyPage[] => [
  ...(news.level !== null ? [{ kind: 'level' } as const] : []),
  ...news.badges.map(badge => ({ kind: 'badge', id: badge.id }) as const)
]

// A profile's place in the household game: its grade, how far the next one is, its badges. Its own sheet shows every
// badge and chooses the one its avatar wears; another profile's shows those it earned. What one's own earned since
// it was last opened is celebrated first.
// How long a sheet waits for its game before it opens all the same.
const WAIT_MS = 600

const ProfileSheet = ({ profile, onClose }: ProfileSheetProps) => {
  const { t } = useTranslation()
  const current = useCurrentProfile()
  const mine = profile !== null && profile.id === current?.id
  const [party, setParty] = useState<{ pages: PartyPage[]; at: number } | null>(null)
  // The sheet just after a celebration: its grade and bar play their part.
  const [cheer, setCheer] = useState(false)
  // The sheet waits for its game before it opens, the first time and with news on one's avatar: it opens on its
  // badges (no placeholder flashing first) or on the celebration, at that page's size, rather than growing into it.
  // Never more than a moment: a slow network opens it on the placeholder.
  const news = useGameNews(mine) !== null
  const id = profile?.id ?? null
  // The profile the dialog is open for: once open, it stays so whatever arrives.
  const [shown, setShown] = useState<number | null>(null)
  const held = id !== null && shown !== id && ((mine && news) || !loaded.has(id))
  if (id === null && shown !== null) setShown(null)
  if (id !== null && shown !== id && !held) setShown(id)
  // Shown is seen: the sparkle leaves the avatar as the sheet opens on what it announced.
  // Both the opening and the sheet's own fetch may find the news: one celebration, one mark.
  const celebrated = useRef(false)
  const celebrate = (pages: PartyPage[]) => {
    if (celebrated.current) return
    celebrated.current = true
    setParty({ pages, at: 0 })
    void seeGameNews()
  }
  useEffect(() => {
    if (!held || id === null) return
    let live = true
    const open = () => live && setShown(id)
    const slow = setTimeout(open, WAIT_MS)
    ;(mine ? getMyGame() : getProfileGame(id))
      .then(game => {
        loaded.set(id, game)
        if (live && mine && game.news && hasNews(game.news)) celebrate(pagesOf(game.news))
      })
      .catch(() => {})
      .finally(open)
    return () => {
      live = false
      clearTimeout(slow)
    }
    // mine goes with id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [held, id])
  const close = () => {
    celebrated.current = false
    setParty(null)
    setCheer(false)
    onClose()
  }
  // From one celebration's page to the next, then to the sheet: the dialog's height follows, rather than jumping.
  const height = useRef<number | null>(null)
  const dialogOf = () => document.querySelector<HTMLElement>(`dialog.${styles.dialog}[open]`)
  const step = party ? party.at : cheer ? -1 : -2
  useLayoutEffect(() => {
    const from = height.current
    height.current = null
    const dialog = dialogOf()
    if (from === null || !dialog || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const to = dialog.getBoundingClientRect().height
    if (Math.abs(to - from) < 1) return
    // Free of its cap meanwhile: the celebration's pages may be taller than the sheet's.
    dialog.animate(
      [
        { height: `${from}px`, maxHeight: 'none' },
        { height: `${to}px`, maxHeight: 'none' }
      ],
      {
        duration: 300,
        easing: 'cubic-bezier(0.2, 0, 0, 1)'
      }
    )
  }, [step])
  const page = party?.pages[party.at]
  const title = page ? t(page.kind === 'level' ? 'game.newGrade' : 'game.newBadge') : mine ? 'Ton profil' : 'Profil'
  return (
    <Dialog
      open={profile !== null && shown === profile.id}
      onClose={close}
      title={title}
      className={`${styles.dialog} ${page ? styles.tall : ''}`}
    >
      {profile && (
        <SheetContent
          key={profile.id}
          profile={profile}
          mine={mine}
          onClose={close}
          page={page ?? null}
          last={party !== null && party.at === party.pages.length - 1}
          cheer={cheer}
          onParty={celebrate}
          onPartyNext={() => {
            if (!party) return
            height.current = dialogOf()?.getBoundingClientRect().height ?? null
            if (party.at < party.pages.length - 1) {
              setParty({ ...party, at: party.at + 1 })
              return
            }
            setParty(null)
            setCheer(true)
          }}
        />
      )}
    </Dialog>
  )
}

// Lucide's star outline, for a reached tier drawn in metal.
const STAR_PATH =
  'M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z'

// A tier's star: empty until reached, then in its tier's metal, a light across it and a darker edge.
const TierStar = ({ step, reached, size }: { step: 1 | 2 | 3; reached: boolean; size: number }) => {
  const gradient = useId()
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
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" className={styles.metalHigh} />
          <stop offset="0.38" className={styles.metalLight} />
          <stop offset="0.5" className={styles.metalBase} />
          <stop offset="0.56" className={styles.metalDeep} />
          <stop offset="0.8" className={styles.metalSoft} />
          <stop offset="1" className={styles.metalEnd} />
        </linearGradient>
      </defs>
      <path d={STAR_PATH} fill={`url(#${gradient})`} />
    </svg>
  )
}

// The three tiers as stars, each in its tier's metal once reached.
const Stars = ({ tier, size }: { tier: BadgeTier; size: number }) => {
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
const BadgeDetail = ({ badge, shine }: { badge: BadgeProgress; shine?: 'won' | 'earned' }) => {
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

const points = (value: number) => value.toLocaleString(getLanguage())

// The burst around the avatar as its ring closes: the app's colours, as the confetti's.
const SPARKS = [
  '--rust',
  '--topic-belgique',
  '--topic-monde',
  '--topic-tech',
  '--topic-science',
  '--topic-jeux-video',
  '--ai'
]
const SPARK_COUNT = 16
// When the ring and the bar are full: the grade changes, the burst and the confetti go off (as in the CSS).
const LEVEL_FULL_MS = 1300

// The new grade: the avatar's ring and the bar from the grade before fill to the brim; then the level and the grade
// change in place, with a burst around the avatar and confetti.
const LevelPage = ({ profile, game }: { profile: NonNullable<ProfileSheetProps['profile']>; game: ProfileGame }) => {
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

const SheetContent = ({
  profile,
  mine,
  onClose,
  page,
  last,
  cheer,
  onParty,
  onPartyNext
}: {
  profile: NonNullable<ProfileSheetProps['profile']>
  mine: boolean
  onClose: () => void
  page: PartyPage | null
  last: boolean
  cheer: boolean
  onParty: (pages: PartyPage[]) => void
  onPartyNext: () => void
}) => {
  const { t } = useTranslation()
  const sheet = useRef<HTMLDivElement>(null)
  const pageKey = page ? (page.kind === 'level' ? 'level' : page.id) : 'sheet'
  // A badge opened from the grid: its card takes the sheet's place, as any dialog opened from another one, and the
  // header's arrow goes back to the sheet.
  const [opened, setOpened] = useState<BadgeId | null>(null)
  // A page opened or left: from its top, whatever the scroll it replaces.
  useEffect(() => {
    sheet.current?.parentElement?.scrollTo({ top: 0 })
  }, [pageKey])
  // The page the sheet opened on comes with the dialog; the next ones fade in, as a card changing its content.
  const [firstKey] = useState(pageKey)
  const swap = pageKey === firstKey ? '' : styles.swap
  const [game, setGame] = useState<ProfileGame | null>(() => loaded.get(profile.id) ?? null)
  const [wearing, setWearing] = useState<BadgeId | null>(null)
  // On a computer the sidebar's selector changes profile: the sheet has no button for it.
  const desktop = useIsDesktop()

  const id = profile.id
  useEffect(() => {
    let live = true
    // The avatars' rings too, as they may have moved since the app opened.
    void refreshGame()
    ;(mine ? getMyGame() : getProfileGame(id))
      .then(next => {
        loaded.set(id, next)
        if (!live) return
        setGame(next)
        if (mine && hasNews(next.news) && next.news) onParty(pagesOf(next.news))
      })
      .catch(() => live && showError(textNow('game.loadFailed')))
    return () => {
      live = false
    }
    // onParty only once, when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, mine])

  // The worn badge again takes it off.
  const wear = (badge: BadgeId, then?: () => void) => {
    if (!game || wearing) return
    const next = game.badge?.id === badge ? null : badge
    setWearing(badge)
    wearBadge(next)
      .then(() => {
        const tier = game.badges.find(candidate => candidate.id === next)?.tier ?? 0
        const worn = { ...game, badge: next ? { id: next, tier } : null }
        loaded.set(id, worn)
        setGame(worn)
        void refreshGame()
        then?.()
      })
      .catch(() => showError(t('game.wearFailed')))
      .finally(() => setWearing(null))
  }

  const footer = mine && !desktop
  const badge = opened && game ? game.badges.find(candidate => candidate.id === opened) : undefined

  if (page && game) {
    const partyBadge = page.kind === 'badge' ? game.badges.find(candidate => candidate.id === page.id) : undefined
    const worn = partyBadge && game.badge?.id === partyBadge.id
    return (
      <div ref={sheet} className={styles.sheet}>
        <div key={pageKey} className={swap}>
          {page.kind === 'level' ? (
            <LevelPage profile={profile} game={game} />
          ) : (
            partyBadge && <BadgeDetail badge={partyBadge} shine="won" />
          )}
        </div>
        {/* Fixed, in the dialog's top layer: over the whole screen. */}
        {page.kind === 'level' && <Confetti delay={LEVEL_FULL_MS} />}
        <DialogActions>
          {partyBadge && mine && !worn && (
            <Button busy={wearing === partyBadge.id} onClick={() => wear(partyBadge.id, onPartyNext)}>
              {t('game.wearIt')}
            </Button>
          )}
          <Button look="primary" onClick={onPartyNext}>
            {last ? t('game.great') : t('game.next')}
          </Button>
        </DialogActions>
      </div>
    )
  }

  return (
    <div ref={sheet} className={styles.sheet}>
      <div key={pageKey} className={`${styles.body} ${swap}`} data-cheer={cheer ? '' : undefined}>
        <div className={styles.identity}>
          <ProfileAvatar profile={profile} size={72} />
          <span className={styles.name}>{profile.name}</span>
          <span className={styles.meta}>{game ? t('game.level', { level: game.level }) : '\u00a0'}</span>
        </div>

        <div className={styles.level} data-topic={profile.color} data-tour="level">
          <span className={styles.grades}>
            <span className={styles.grade}>{game?.name ?? '\u00a0'}</span>
            {game?.next && <span className={styles.nextGrade}>{game.next.name}</span>}
          </span>
          <span className={styles.bar}>
            <span className={styles.fill} style={{ width: `${(game?.progress ?? 0) * 100}%` }} />
          </span>
          <span className={`${styles.meta} ${styles.points}`}>
            {game ? (
              <>
                {/* As the bar: from where this level starts to the next one; the total at the last level. */}
                <b>{points(game.next ? game.points - game.since : game.points)}</b>
                {game.next ? ` / ${points(game.next.points - game.since)}` : ''} {t('game.pts')}
              </>
            ) : (
              '\u00a0'
            )}
          </span>
        </div>

        {!game && <BadgesSkeleton />}
        {game && (
          <ul className={`${styles.badges} appear`}>
            {/* Earned ones first, then those still to earn (only on one's own sheet). */}
            {[
              ...game.badges.filter(badge => badge.tier > 0),
              ...(mine ? game.badges.filter(badge => badge.tier === 0) : [])
            ].map(badge => {
              const worn = game.badge?.id === badge.id
              const earned = badge.tier > 0
              return (
                <li key={badge.id}>
                  <button
                    type="button"
                    className={`${styles.card} ${earned ? '' : styles.locked}`}
                    data-worn={worn ? '' : undefined}
                    aria-label={t('game.open', { name: badge.name })}
                    onClick={() => setOpened(badge.id)}
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
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {footer && (
        <DialogActions>
          <Button href={PROFILES_HREF} onClick={onClose}>
            {t('profiles.switch')}
          </Button>
        </DialogActions>
      )}

      <Dialog
        open={badge !== undefined}
        onClose={() => setOpened(null)}
        title={badge?.name}
        className={`${styles.dialog} ${styles.tall}`}
      >
        {badge && (
          <div className={styles.sheet}>
            <BadgeDetail badge={badge} shine={badge.tier > 0 ? 'earned' : undefined} />
            {/* One's own earned badge: worn on the avatar from here. */}
            {mine && badge.tier > 0 && (
              <DialogActions>
                <Button
                  look={game?.badge?.id === badge.id ? 'neutral' : 'primary'}
                  busy={wearing === badge.id}
                  // Back to the sheet, where the avatar shows the badge worn (or no longer).
                  onClick={() => wear(badge.id, () => setOpened(null))}
                >
                  {game?.badge?.id === badge.id ? t('game.unwear') : t('game.wear')}
                </Button>
              </DialogActions>
            )}
          </div>
        )}
      </Dialog>
    </div>
  )
}

export default ProfileSheet
