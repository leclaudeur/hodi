import { Plus, UserPlus, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MAX_PROFILES, PROFILE_COLORS, type Profile, getYouthRules } from '../../../api.ts'
import { isYoung, useProfiles } from '../../../lib/profiles.ts'
import { PROFILES_HREF } from '../../../lib/use-hash-route.ts'
import { useIsDesktop } from '../../../lib/use-media.ts'
import Button from '../../../ui/Button.tsx'
import CodeDialog from '../../profiles/CodeDialog.tsx'
import SectionPage from '../SectionPage.tsx'
import RowsSkeleton from '../SettingsSkeleton.tsx'
import styles from '../Settings.module.css'
import profileStyles from './ProfilesSection.module.css'
import {
  EditProfileDialog,
  type Giving,
  NewProfileDialog,
  editActionsOf,
  ProfileRow,
  hintOf,
  kindsOf,
  profileConfirms
} from './ProfilesParts.tsx'

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
  withAccounts: boolean
  onAdd: () => void
  onInvite: () => void
}

// Under the list: a new profile, an invitation for an adult, and changing profile off a computer.
const AddButtons = ({ parent, room, adding, withAccounts, onAdd, onInvite }: AddButtonsProps) => {
  const { t } = useTranslation()
  const desktop = useIsDesktop()
  return (
    <div className={profileStyles.actions}>
      {parent && room && !adding && (
        <Button icon={Plus} onClick={onAdd}>
          {t('settings.profiles.add')}
        </Button>
      )}
      {parent && withAccounts && room && (
        <Button icon={UserPlus} onClick={onInvite}>
          {t('profiles.code.invite')}
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

// The household's profiles: each reader's name, colour and photo. The admin adds, changes and removes them;
// a member changes its own. Each one has its own "Enregistrés", reads, stats, followed subjects and settings.
const ProfilesSection = ({ layout }: { layout: 'desktop' | 'phone' }) => {
  const { t } = useTranslation()
  const value = useProfiles({ fresh: true })
  // The profile being changed, 'new' for one being added.
  const [editing, setEditing] = useState<number | 'new' | null>(null)
  const [giving, setGiving] = useState<Giving>(undefined)
  // Its parents see a young profile's time a day under its name.
  const viewer = value?.profiles.find(profile => profile.id === value.current)
  const daily = useDailyMinutes(
    viewer?.kind === 'adult' ? (value?.profiles ?? []).filter(isYoung).map(profile => profile.id) : []
  )

  const title = t('settings.nav.profiles')
  const intro = t('settings.profiles.intro', { max: MAX_PROFILES })

  if (!value)
    return (
      <SectionPage title={title} intro={intro} layout={layout}>
        <RowsSkeleton rows={2} lead="round" end="button" />
      </SectionPage>
    )

  const { profiles, current } = value
  const own = profiles.find(profile => profile.id === current)
  const admin = own?.role === 'admin'
  // Every adult is a parent: it adds and changes the young profiles.
  const parent = own?.kind === 'adult'
  // Codes come with personal accounts: on an install still on the household's password, its admin moves first.
  const withAccounts = own?.hasAccount === true
  const mayEdit = (profile: Profile) => admin || profile.id === current || (parent && isYoung(profile))
  const edited = typeof editing === 'number' ? profiles.find(profile => profile.id === editing) : undefined
  const confirms = profileConfirms({ t, onEditing: setEditing, onGiving: setGiving })
  const editActions = editActionsOf(edited, { admin, current, withAccounts, confirms, onGiving: setGiving })

  return (
    <SectionPage title={title} intro={intro} layout={layout}>
      <ul className={styles.card}>
        {profiles.map(profile => (
          <ProfileRow
            key={profile.id}
            profile={profile}
            active={profile.id === current}
            managed={parent && isYoung(profile)}
            editable={mayEdit(profile)}
            hint={hintOf(profile, parent, daily, t)}
            onEdit={() => setEditing(profile.id)}
          />
        ))}
      </ul>

      <AddButtons
        parent={parent}
        room={profiles.length < MAX_PROFILES}
        adding={editing === 'new'}
        withAccounts={withAccounts}
        onAdd={() => setEditing('new')}
        onInvite={() => setGiving(null)}
      />

      {/* Adding and changing a profile happen in a dialog, as every action in Réglages. */}
      <NewProfileDialog
        open={editing === 'new'}
        defaultColor={PROFILE_COLORS.find(color => !profiles.some(profile => profile.color === color))}
        kinds={kindsOf(undefined, current, admin)}
        onClose={() => setEditing(null)}
      />
      <EditProfileDialog
        edited={edited}
        kinds={kindsOf(edited, current, admin)}
        onClose={() => setEditing(null)}
        {...editActions}
      />
      {/* Remade at each opening: a new code, nothing left of the one before. Opened from the profile's dialog, it takes
          that one's place as the same card, with a way back to it (lib/dialog-stack.ts). */}
      <CodeDialog
        key={giving === undefined ? 'closed' : (giving?.id ?? 'invite')}
        target={giving}
        make={giving?.made ? () => Promise.resolve(giving.made!) : undefined}
        onClose={() => setGiving(undefined)}
      />
    </SectionPage>
  )
}

export default ProfilesSection
