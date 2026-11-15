import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type BadgeId, type BadgeProgress, type ProfileGame, getMyGame, getProfileGame, wearBadge } from '../api.ts'
import { hasNews, refreshGame } from '../lib/game.ts'
import { t as textNow } from '../lib/i18n.ts'
import { isLinkedDevice } from '../lib/linked-device.ts'
import { showError } from '../lib/toast.ts'
import { useIsDesktop } from '../lib/use-media.ts'
import { PROFILES_HREF } from '../lib/use-hash-route.ts'
import { useAvatarMenu } from '../plugins/Slots.tsx'
import Button from './Button.tsx'
import Confetti from './Confetti.tsx'
import Dialog from './Dialog.tsx'
import DialogActions from './DialogActions.tsx'
import ProfileAvatar from './ProfileAvatar.tsx'
import { BadgeDetail, BadgeGrid, BadgesSkeleton } from './ProfileBadges.tsx'
import LevelPage, { LEVEL_FULL_MS } from './ProfileLevelPage.tsx'
import { type PartyPage, type SheetProfile, loaded, pagesOf, points } from './profile-sheet-game.ts'
import styles from './ProfileSheet.module.css'

type Wear = (badge: BadgeId, then?: () => void) => void

// The profile's game, fetched as the sheet opens, and the badge its avatar wears.
const useSheetGame = (id: number, mine: boolean, onParty: (pages: PartyPage[]) => void) => {
  const { t } = useTranslation()
  const [game, setGame] = useState<ProfileGame | null>(() => loaded.get(id) ?? null)
  const [wearing, setWearing] = useState<BadgeId | null>(null)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onParty only once, when the sheet opens
  }, [id, mine])

  // The worn badge again takes it off.
  const wear: Wear = (badge, then) => {
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
  return { game, wearing, wear }
}

interface PartyProps {
  page: PartyPage
  game: ProfileGame
  profile: SheetProfile
  mine: boolean
  last: boolean
  wearing: BadgeId | null
  wear: Wear
  onPartyNext: () => void
  pageKey: string
  swap: string | undefined
}

// A celebration's page: the new grade, or a new badge to wear at once.
const Party = ({ page, game, profile, mine, last, wearing, wear, onPartyNext, pageKey, swap }: PartyProps) => {
  const { t } = useTranslation()
  const partyBadge = page.kind === 'badge' ? game.badges.find(candidate => candidate.id === page.id) : undefined
  const worn = partyBadge && game.badge?.id === partyBadge.id
  return (
    <>
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
    </>
  )
}

// The profile's avatar, name and level, then its grade and the bar to the next one.
const Standing = ({ profile, game }: { profile: SheetProfile; game: ProfileGame | null }) => {
  const { t } = useTranslation()
  return (
    <>
      <div className={styles.identity}>
        <ProfileAvatar profile={profile} size={72} />
        <span className={styles.name}>{profile.name}</span>
        <span className={styles.meta}>{game ? t('game.level', { level: game.level }) : ' '}</span>
      </div>

      <div className={styles.level} data-topic={profile.color} data-tour="level">
        <span className={styles.grades}>
          <span className={styles.grade}>{game?.name ?? ' '}</span>
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
            ' '
          )}
        </span>
      </div>
    </>
  )
}

// One's own sheet on a phone or a tablet: a plugin's entries of the avatar's menu (« Changer de foyer »), beside
// « Changer de profil ».
const SheetFooter = ({ onClose }: { onClose: () => void }) => {
  const { t } = useTranslation()
  const pluginEntries = useAvatarMenu()
  return (
    <DialogActions className={pluginEntries.length > 0 ? styles.stackedActions : undefined}>
      {pluginEntries.map(entry => (
        <Button
          key={entry.key}
          onClick={() => {
            onClose()
            entry.onClick()
          }}
        >
          {entry.icon}
          {entry.label}
        </Button>
      ))}
      <Button href={PROFILES_HREF} onClick={onClose} className={styles.switchProfile}>
        {t('profiles.switch')}
      </Button>
    </DialogActions>
  )
}

interface BadgeDialogProps {
  badge: BadgeProgress | undefined
  mine: boolean
  wornId: BadgeId | undefined
  wearing: BadgeId | null
  wear: Wear
  onClose: () => void
}

// A badge opened from the grid: its card takes the sheet's place, as any dialog opened from another one, and the
// header's arrow goes back to the sheet.
const BadgeDialog = ({ badge, mine, wornId, wearing, wear, onClose }: BadgeDialogProps) => {
  const { t } = useTranslation()
  return (
    <Dialog
      open={badge !== undefined}
      onClose={onClose}
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
                look={wornId === badge.id ? 'neutral' : 'primary'}
                busy={wearing === badge.id}
                // Back to the sheet, where the avatar shows the badge worn (or no longer).
                onClick={() => wear(badge.id, onClose)}
              >
                {wornId === badge.id ? t('game.unwear') : t('game.wear')}
              </Button>
            </DialogActions>
          )}
        </div>
      )}
    </Dialog>
  )
}

interface SheetContentProps {
  profile: SheetProfile
  mine: boolean
  onClose: () => void
  page: PartyPage | null
  last: boolean
  cheer: boolean
  onParty: (pages: PartyPage[]) => void
  onPartyNext: () => void
}

const pageKeyOf = (page: PartyPage | null) => {
  if (!page) return 'sheet'
  return page.kind === 'level' ? 'level' : page.id
}

const SheetContent = ({ profile, mine, onClose, page, last, cheer, onParty, onPartyNext }: SheetContentProps) => {
  const sheet = useRef<HTMLDivElement>(null)
  const pageKey = pageKeyOf(page)
  const [opened, setOpened] = useState<BadgeId | null>(null)
  // A page opened or left: from its top, whatever the scroll it replaces.
  useEffect(() => {
    sheet.current?.parentElement?.scrollTo({ top: 0 })
  }, [pageKey])
  // The page the sheet opened on comes with the dialog; the next ones fade in, as a card changing its content.
  const [firstKey] = useState(pageKey)
  const swap = pageKey === firstKey ? '' : styles.swap
  const { game, wearing, wear } = useSheetGame(profile.id, mine, onParty)
  // On a computer the sidebar's selector changes profile: the sheet has no button for it.
  const desktop = useIsDesktop()
  const footer = mine && !desktop && !isLinkedDevice()
  const badge = opened && game ? game.badges.find(candidate => candidate.id === opened) : undefined

  if (page && game) {
    return (
      <div ref={sheet} className={styles.sheet}>
        <Party {...{ page, game, profile, mine, last, wearing, wear, onPartyNext, pageKey, swap }} />
      </div>
    )
  }

  return (
    <div ref={sheet} className={styles.sheet}>
      <div key={pageKey} className={`${styles.body} ${swap}`} data-cheer={cheer ? '' : undefined}>
        <Standing profile={profile} game={game} />
        {game ? <BadgeGrid game={game} mine={mine} onOpen={setOpened} /> : <BadgesSkeleton />}
      </div>
      {footer && <SheetFooter onClose={onClose} />}
      <BadgeDialog
        badge={badge}
        mine={mine}
        wornId={game?.badge?.id}
        wearing={wearing}
        wear={wear}
        onClose={() => setOpened(null)}
      />
    </div>
  )
}

export default SheetContent
