import type { TFunction } from 'i18next'
import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import type { Profile, ProfileKind } from '../../../api.ts'
import { isYoung } from '../../../lib/profiles.ts'
import styles from '../Settings.module.css'
import { ProfileRow, hintOf } from './ProfilesParts.tsx'

const GROUPS = [
  { kind: 'adult', label: 'settings.profiles.groups.adults' },
  { kind: 'teen', label: 'settings.profiles.groups.teens' },
  { kind: 'child', label: 'settings.profiles.groups.children' }
] as const satisfies readonly { kind: ProfileKind; label: string }[]

interface ProfileGroupsProps {
  profiles: Profile[]
  current: number | null
  parent: boolean
  daily: Map<number, number | null>
  mayEdit: (profile: Profile) => boolean
  onEdit: (id: number) => void
  // The household's admin, for another adult with an account.
  others?: { handOver: (profile: Profile) => void; remove: (profile: Profile) => void }
}

// Under an adult's name: the admin, or whether they have their own account yet.
const adultHint = (profile: Profile, t: TFunction) => {
  if (profile.role === 'admin') return t('settings.roles.admin')
  return t(profile.hasAccount ? 'settings.profiles.ownAccount' : 'settings.profiles.waitingAccount')
}

// Another adult with their own account: their name, colour and photo are theirs alone.
export const isOtherAccount = (profile: Profile, current: number | null) =>
  profile.kind === 'adult' && profile.hasAccount && profile.id !== current

// Its own profile, a young one for a parent, any but another adult's with an account for the admin.
export const mayEditOf = (
  profile: Profile,
  { current, parent, admin }: { current: number | null; parent: boolean; admin: boolean }
) => profile.id === current || (parent && isYoung(profile)) || (admin && !isOtherAccount(profile, current))

// Adultes, Ados, Enfants: each kind its card, an empty one left out.
const ProfileGroups = ({ profiles, current, parent, daily, mayEdit, onEdit, others }: ProfileGroupsProps) => {
  const { t } = useTranslation()
  return GROUPS.map(({ kind, label }) => {
    const group = profiles.filter(profile => profile.kind === kind)
    if (group.length === 0) return null
    return (
      <Fragment key={kind}>
        <h2 className={styles.label}>{t(label)}</h2>
        <ul className={styles.card}>
          {group.map(profile => {
            const other = others && isOtherAccount(profile, current) ? others : undefined
            return (
              <ProfileRow
                key={profile.id}
                profile={profile}
                active={profile.id === current}
                managed={parent && isYoung(profile)}
                editable={mayEdit(profile)}
                hint={kind === 'adult' ? adultHint(profile, t) : hintOf(profile, parent, daily, t)}
                onEdit={() => onEdit(profile.id)}
                onHandOver={other && (() => other.handOver(profile))}
                onRemove={other && (() => other.remove(profile))}
              />
            )
          })}
        </ul>
      </Fragment>
    )
  })
}

export default ProfileGroups
