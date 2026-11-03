import { Plus, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MAX_PROFILES, PROFILE_COLORS, type Profile, type ProfileKind, getYouthRules } from '../../../api.ts'
import { addProfile, changePin, editProfile, isYoung, removeProfile, useProfiles } from '../../../lib/profiles.ts'
import { askToConfirm } from '../../../lib/confirm.ts'
import { showError, showSaved } from '../../../lib/toast.ts'
import { PROFILES_HREF, youngProfileHref } from '../../../lib/use-hash-route.ts'
import { useIsDesktop } from '../../../lib/use-media.ts'
import Button from '../../../ui/Button.tsx'
import Chip from '../../../ui/Chip.tsx'
import Dialog from '../../../ui/Dialog.tsx'
import ProfileAvatarButton from '../../../ui/ProfileAvatarButton.tsx'
import ProfileForm from '../../profiles/ProfileForm.tsx'
import RichText from '../../../ui/RichText.tsx'
import SectionPage from '../SectionPage.tsx'
import RowsSkeleton from '../SettingsSkeleton.tsx'
import styles from '../Settings.module.css'
import profileStyles from './ProfilesSection.module.css'
import { formatMinutes } from './young/format.ts'

// Each young profile's time a day (null: no limit), once its rules come.
const useDailyMinutes = (ids: number[]) => {
  const [daily, setDaily] = useState(new Map<number, number | null>())
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

// The household's profiles: each reader's name, colour and photo. The admin adds, changes and removes them;
// a member changes its own. Each one has its own "Enregistrés", reads, stats, followed subjects and settings.
const ProfilesSection = ({ layout }: { layout: 'desktop' | 'phone' }) => {
  const { t } = useTranslation()
  const value = useProfiles({ fresh: true })
  const desktop = useIsDesktop()
  // The profile being changed, 'new' for one being added.
  const [editing, setEditing] = useState<number | 'new' | null>(null)
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
  const mayEdit = (profile: Profile) => admin || profile.id === current || (parent && isYoung(profile))
  // The types one may give: the admin any (its own profile stays an adult), a parent the young ones.
  const kindsFor = (profile?: Profile): ProfileKind[] =>
    profile?.role === 'admin' || (profile && profile.id === current && !admin)
      ? []
      : admin
        ? ['adult', 'teen', 'child']
        : ['teen', 'child']
  const edited = typeof editing === 'number' ? profiles.find(profile => profile.id === editing) : undefined
  const freeColor = PROFILE_COLORS.find(color => !profiles.some(profile => profile.color === color))

  const hintOf = (profile: Profile) => {
    if (parent && isYoung(profile)) {
      const minutes = daily.get(profile.id)
      return minutes === undefined
        ? t(`profileForm.kinds.${profile.kind}`)
        : minutes === null
          ? t('young.noLimit')
          : t('young.perDay', { time: formatMinutes(minutes) })
    }
    return `${profile.role === 'admin' ? t('settings.roles.admin') : t(`profileForm.kinds.${profile.kind}`)}${profile.locked ? ` · ${t('profiles.private')}` : ''}`
  }

  const remove = (id: number, name: string) =>
    askToConfirm({
      title: t('confirm.deleteProfile.title'),
      message: <RichText i18nKey="confirm.deleteProfile.message" values={{ name }} />,
      label: t('confirm.deleteProfile.button'),
      onConfirm: () => {
        // Asked over its form: the form goes with the profile.
        setEditing(null)
        void removeProfile(id)
          .then(() => showSaved(t('settings.profiles.deleted', { name })))
          .catch(() => showError(t('settings.profiles.deleteFailed')))
      }
    })

  return (
    <SectionPage title={title} intro={intro} layout={layout}>
      <ul className={styles.card}>
        {profiles.map(profile => (
          <li key={profile.id} className={styles.row}>
            <ProfileAvatarButton profile={profile} size={44} />
            <span className={styles.rowText}>
              <span className={styles.rowLabel}>{profile.name}</span>
              <span className={styles.rowHint}>{hintOf(profile)}</span>
            </span>
            {profile.id === current && (
              <Chip tone="success" size="row">
                {t('settings.profiles.active')}
              </Chip>
            )}
            {/* A parent manages a young profile on its own page. */}
            {parent && isYoung(profile) ? (
              <>
                <Chip size="row">{t(`profileForm.kinds.${profile.kind}`)}</Chip>
                <Button
                  compact
                  href={youngProfileHref(profile.id)}
                  aria-label={t('young.manageLabel', { name: profile.name })}
                >
                  {t('young.manage')}
                </Button>
              </>
            ) : (
              mayEdit(profile) && (
                <Button
                  compact
                  onClick={() => setEditing(profile.id)}
                  aria-label={t('settings.editName', { name: profile.name })}
                >
                  {t('settings.edit')}
                </Button>
              )
            )}
          </li>
        ))}
      </ul>

      <div className={profileStyles.actions}>
        {parent && profiles.length < MAX_PROFILES && editing !== 'new' && (
          <Button icon={Plus} onClick={() => setEditing('new')}>
            {t('settings.profiles.add')}
          </Button>
        )}
        {/* On a computer, the sidebar's selector changes profile. */}
        {!desktop && (
          <Button icon={Users} href={PROFILES_HREF}>
            {t('profiles.switch')}
          </Button>
        )}
      </div>

      {/* Adding and changing a profile happen in a dialog, as every action in Réglages. */}
      <Dialog open={editing === 'new'} onClose={() => setEditing(null)} title={t('profiles.new')}>
        {editing === 'new' && (
          <ProfileForm
            defaultColor={freeColor}
            kinds={kindsFor()}
            onCancel={() => setEditing(null)}
            onSave={async ({ name, color, photo, kind, avatar }) => {
              await addProfile(name, color, photo ?? null, { kind, avatar })
              setEditing(null)
              showSaved(t('profiles.added', { name }))
            }}
          />
        )}
      </Dialog>
      <Dialog open={edited !== undefined} onClose={() => setEditing(null)} title={t('settings.editProfileTitle')}>
        {edited && (
          <ProfileForm
            profile={edited}
            kinds={kindsFor(edited)}
            onCancel={() => setEditing(null)}
            onDelete={admin && edited.role !== 'admin' ? () => remove(edited.id, edited.name) : undefined}
            // A member's forgotten code: the admin takes it off, the member sets a new one.
            onResetPin={
              admin && edited.id !== current && edited.locked
                ? () =>
                    askToConfirm({
                      title: t('confirm.removePin.title'),
                      message: <RichText i18nKey="confirm.removePin.message" values={{ name: edited.name }} />,
                      label: t('confirm.removePin.button'),
                      onConfirm: () =>
                        void changePin(edited.id, null)
                          .then(() => showSaved(t('settings.profiles.pinRemoved', { name: edited.name })))
                          .catch(() => showError(t('settings.profiles.pinRemoveFailed')))
                    })
                : undefined
            }
            onSave={async ({ name, color, photo, kind, avatar }) => {
              await editProfile(edited.id, { name, color, kind, avatar }, photo)
              setEditing(null)
              showSaved(t('settings.profileSaved'))
            }}
          />
        )}
      </Dialog>
    </SectionPage>
  )
}

export default ProfilesSection
