import { UserPlus, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MAX_PROFILES, getYouthRules } from '../../../api.ts'
import { isYoung, useProfiles } from '../../../lib/profiles.ts'
import { showSaved } from '../../../lib/toast.ts'
import { PROFILES_HREF, youngProfileHref } from '../../../lib/use-hash-route.ts'
import { useIsDesktop } from '../../../lib/use-media.ts'
import Button from '../../../ui/Button.tsx'
import SectionPage from '../SectionPage.tsx'
import RowsSkeleton from '../SettingsSkeleton.tsx'
import profileStyles from './ProfilesSection.module.css'
import ProfileGroups from './ProfileGroups.tsx'
import CreateChildDialog from '../../profiles/CreateChildDialog.tsx'

// Each young profile's time a day (null: no limit), once its rules come.
const useDailyMinutes = (ids: number[]) => {
  const [daily, setDaily] = useState(() => new Map<number, number | null>())
  const key = ids.join(',')
  useEffect(() => {
    let cancelled = false
    for (const id of key ? key.split(',').map(Number) : []) {
      getYouthRules(id)
        .then(limits => {
          if (!cancelled) setDaily(previous => new Map(previous).set(id, limits.rules.dailyMinutes))
        })
        .catch(() => {})
    }
    return () => {
      cancelled = true
    }
  }, [key])
  return daily
}

interface AddButtonsProps {
  parent: boolean
  room: boolean
  adding: boolean
  onAdd: () => void
}

// Under the list: a new young profile, and changing profile off a computer.
const AddButtons = ({ parent, room, adding, onAdd }: AddButtonsProps) => {
  const { t } = useTranslation()
  const desktop = useIsDesktop()
  return (
    <div className={profileStyles.actions}>
      {parent && room && !adding && (
        <Button icon={UserPlus} onClick={onAdd}>
          {t('children.create.title')}
        </Button>
      )}
      {/* On a computer, the sidebar's selector changes profile. */}
      {!desktop && (
        <Button icon={Users} href={PROFILES_HREF}>
          {t('profiles.switch')}
        </Button>
      )}
    </div>
  )
}

// The teens and children: each one's name, colour and photo, its time a day for its parents. Every adult adds and
// changes them; the adults themselves are accounts on the server, each with its own Mon compte.
const ProfilesSection = ({ layout }: { layout: 'desktop' | 'phone' }) => {
  const { t } = useTranslation()
  const value = useProfiles({ fresh: true })
  // A young profile is changed on its own page: only a new one opens a dialog here.
  const [adding, setAdding] = useState(false)
  // Its parents see a young profile's time a day under its name.
  const viewer = value?.profiles.find(profile => profile.id === value.current)
  const daily = useDailyMinutes(
    viewer?.kind === 'adult' ? (value?.profiles ?? []).filter(isYoung).map(profile => profile.id) : []
  )

  const title = t('settings.nav.profiles')
  const intro = t('settings.profiles.intro')

  if (!value)
    return (
      <SectionPage title={title} intro={intro} layout={layout}>
        <RowsSkeleton rows={2} lead="round" end="button" />
      </SectionPage>
    )

  const { profiles, current } = value
  const own = profiles.find(profile => profile.id === current)
  // Every adult is a parent: it adds and changes the young profiles.
  const parent = own?.kind === 'adult'
  const young = profiles.filter(isYoung)

  return (
    <SectionPage title={title} intro={intro} layout={layout}>
      <ProfileGroups profiles={young} current={current} parent={parent} daily={daily} />

      <AddButtons parent={parent} room={profiles.length < MAX_PROFILES} adding={adding} onAdd={() => setAdding(true)} />

      {/* A new teen or child is an account of its own, with its password: its card opens once it is made. */}
      <CreateChildDialog
        open={adding}
        taken={profiles.map(profile => profile.color)}
        onClose={() => setAdding(false)}
        onCreated={child => {
          setAdding(false)
          showSaved(t('children.create.done', { name: child.name }))
          window.location.hash = youngProfileHref(child.profileId)
        }}
      />
    </SectionPage>
  )
}

export default ProfilesSection
