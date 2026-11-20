import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import type { Profile, ProfileKind } from '../../../api.ts'
import styles from '../Settings.module.css'
import { ProfileRow, hintOf } from './ProfilesParts.tsx'

const GROUPS = [
  { kind: 'teen', label: 'settings.profiles.groups.teens' },
  { kind: 'child', label: 'settings.profiles.groups.children' }
] as const satisfies readonly { kind: ProfileKind; label: string }[]

interface ProfileGroupsProps {
  profiles: Profile[]
  current: number | null
  parent: boolean
  daily: Map<number, number | null>
}

// Ados, Enfants: each kind its card, an empty one left out. Every adult is a parent of them.
const ProfileGroups = ({ profiles, current, parent, daily }: ProfileGroupsProps) => {
  const { t } = useTranslation()
  return GROUPS.map(({ kind, label }) => {
    const group = profiles.filter(profile => profile.kind === kind)
    if (group.length === 0) return null
    return (
      <Fragment key={kind}>
        <h2 className={styles.label}>{t(label)}</h2>
        <ul className={styles.card}>
          {group.map(profile => (
            <ProfileRow
              key={profile.id}
              profile={profile}
              active={profile.id === current}
              managed={parent}
              hint={hintOf(profile, parent, daily, t)}
            />
          ))}
        </ul>
      </Fragment>
    )
  })
}

export default ProfileGroups
