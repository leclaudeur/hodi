import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getMyGame, getProfileGame } from '../api.ts'
import { hasNews, seeGameNews, useGameNews } from '../lib/game.ts'
import { useCurrentProfile } from '../lib/profiles.ts'
import Dialog from './Dialog.tsx'
import SheetContent from './ProfileSheetContent.tsx'
import { type PartyPage, type SheetProfile, loaded, pagesOf } from './profile-sheet-game.ts'
import styles from './ProfileSheet.module.css'

interface ProfileSheetProps {
  profile: SheetProfile | null
  onClose: () => void
}

// How long a sheet waits for its game before it opens all the same.
const WAIT_MS = 600

// What one's own sheet celebrates, the page shown, and the sheet's cheer once it is over.
const useParty = () => {
  const [party, setParty] = useState<{ pages: PartyPage[]; at: number } | null>(null)
  // The sheet just after a celebration: its grade and bar play their part.
  const [cheer, setCheer] = useState(false)
  // Shown is seen: the sparkle leaves the avatar as the sheet opens on what it announced.
  // Both the opening and the sheet's own fetch may find the news: one celebration, one mark.
  const celebrated = useRef(false)
  const celebrate = (pages: PartyPage[]) => {
    if (celebrated.current) return
    celebrated.current = true
    setParty({ pages, at: 0 })
    void seeGameNews()
  }
  const reset = () => {
    celebrated.current = false
    setParty(null)
    setCheer(false)
  }
  // To the next page, or to the sheet after the last one; before: just as it moves.
  const next = (before: () => void) => {
    if (!party) return
    before()
    if (party.at < party.pages.length - 1) {
      setParty({ ...party, at: party.at + 1 })
      return
    }
    setParty(null)
    setCheer(true)
  }
  return { party, cheer, celebrate, reset, next }
}

// The sheet waits for its game before it opens, the first time and with news on one's avatar: it opens on its
// badges (no placeholder flashing first) or on the celebration, at that page's size, rather than growing into it.
// Never more than a moment: a slow network opens it on the placeholder. Returns the profile the dialog is open for:
// once open, it stays so whatever arrives.
const useShownProfile = (id: number | null, mine: boolean, celebrate: (pages: PartyPage[]) => void) => {
  const news = useGameNews(mine) !== null
  const [shown, setShown] = useState<number | null>(null)
  const held = id !== null && shown !== id && ((mine && news) || !loaded.has(id))
  if (id === null && shown !== null) setShown(null)
  if (id !== null && shown !== id && !held) setShown(id)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mine goes with id
  }, [held, id])
  return shown
}

const dialogOf = () => document.querySelector<HTMLElement>(`dialog.${styles.dialog}[open]`)

// From one celebration's page to the next, then to the sheet: the dialog's height follows, rather than jumping.
// The function returned keeps the height before a step.
const useHeightFollow = (step: number) => {
  const height = useRef<number | null>(null)
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
  return () => {
    height.current = dialogOf()?.getBoundingClientRect().height ?? null
  }
}

const stepOf = (party: { at: number } | null, cheer: boolean) => {
  if (party) return party.at
  return cheer ? -1 : -2
}

// A profile's place in the household game: its grade, how far the next one is, its badges. Its own sheet shows every
// badge and chooses the one its avatar wears; another profile's shows those it earned. What one's own earned since
// it was last opened is celebrated first.
const ProfileSheet = ({ profile, onClose }: ProfileSheetProps) => {
  const { t } = useTranslation()
  const current = useCurrentProfile()
  const mine = profile !== null && profile.id === current?.id
  const { party, cheer, celebrate, reset, next } = useParty()
  const shown = useShownProfile(profile?.id ?? null, mine, celebrate)
  const keepHeight = useHeightFollow(stepOf(party, cheer))
  const close = () => {
    reset()
    onClose()
  }
  const page = party?.pages[party.at]
  const title = page
    ? t(page.kind === 'level' ? 'game.newGrade' : 'game.newBadge')
    : t(mine ? 'game.yourProfile' : 'game.profile')
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
          onPartyNext={() => next(keepHeight)}
        />
      )}
    </Dialog>
  )
}

export default ProfileSheet
