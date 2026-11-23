import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type SharePerson, getShareSenders } from '../../../api.ts'
import { updatePreferences, usePreferences } from '../../../lib/preferences.ts'
import ProfileAvatar from '../../../ui/ProfileAvatar.tsx'
import Toggle from '../../../ui/Toggle.tsx'
import SectionPage from '../SectionPage.tsx'
import SettingRow from '../SettingRow.tsx'
import styles from '../Settings.module.css'

// The people this profile shares with (its family, this device, lately) and those it turned off; asked again once
// sharing is back on.
const useSenders = (on: boolean) => {
  const [senders, setSenders] = useState<SharePerson[]>([])
  useEffect(() => {
    if (on)
      getShareSenders()
        .then(setSenders)
        .catch(() => {})
  }, [on])
  return senders
}

// "Partages": sending articles to other people, and receiving theirs. Off, the feature is gone from the whole app for
// this profile; on, each person's shares can be turned off.
const SharingSection = ({ layout }: { layout: 'desktop' | 'phone' }) => {
  const { t } = useTranslation()
  const preferences = usePreferences()
  const others = useSenders(preferences.sharing)

  return (
    <SectionPage title={t('settings.nav.sharing')} intro={t('settings.sharing.intro')} layout={layout}>
      <div className={styles.card}>
        <SettingRow
          label={t('settings.sharing.toggle')}
          hint={t(preferences.sharing ? 'settings.sharing.onHint' : 'settings.sharing.offHint')}
        >
          <Toggle
            label={t('settings.sharing.toggle')}
            checked={preferences.sharing}
            onChange={sharing => updatePreferences({ sharing })}
          />
        </SettingRow>
      </div>

      {preferences.sharing && others.length > 0 && (
        <ul className={styles.card} aria-label={t('settings.sharing.receiveFrom')}>
          {others.map(profile => {
            const muted = preferences.mutedSharers.includes(profile.id)
            return (
              <SettingRow
                key={profile.id}
                as="li"
                label={profile.name}
                hint={t(muted ? 'settings.sharing.mutedHint' : 'settings.sharing.receivingHint')}
                lead={<ProfileAvatar profile={profile} size={44} />}
              >
                <Toggle
                  label={t('settings.sharing.receive', { name: profile.name })}
                  checked={!muted}
                  onChange={receive =>
                    updatePreferences({
                      mutedSharers: receive
                        ? preferences.mutedSharers.filter(id => id !== profile.id)
                        : [...preferences.mutedSharers, profile.id]
                    })
                  }
                />
              </SettingRow>
            )
          })}
        </ul>
      )}
    </SectionPage>
  )
}

export default SharingSection
