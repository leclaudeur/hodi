import { Activity, Bell, BellOff, X } from 'lucide-react'
import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useFollowedItems } from '../../../lib/followed-items.ts'
import { countByKind } from '../../../lib/format.ts'
import { updateNotificationSettings, useNotificationSettings } from '../../../lib/notifications.ts'
import { updatePreferences, usePreferences } from '../../../lib/preferences.ts'
import { settingsHref } from '../../../lib/use-hash-route.ts'
import { foldText, wordPattern } from '../../../lib/word-match.ts'
import Notice from '../../../ui/Notice.tsx'
import EmptyCard from '../EmptyCard.tsx'
import Toggle from '../../../ui/Toggle.tsx'
import SectionPage from '../SectionPage.tsx'
import SettingRow from '../SettingRow.tsx'
import RoundButton from '../../../ui/RoundButton.tsx'
import styles from '../Settings.module.css'
import followedStyles from './FollowedSection.module.css'
import WordForm from './WordForm.tsx'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

interface FollowedSectionProps {
  layout: 'desktop' | 'phone'
  onUnauthorized: () => void
}

// Followed subjects: their articles get a star and gather in "Suivis"; each can send an alert or stay silent.
const FollowedSection = ({ layout, onUnauthorized }: FollowedSectionProps) => {
  const { t } = useTranslation()
  const preferences = usePreferences()
  const notifications = useNotificationSettings()
  const { items } = useFollowedItems(onUnauthorized)
  const { followedWords } = preferences
  const [now] = useState(Date.now)

  // Articles and videos of the last 7 days about each subject (one can count for several).
  const weekItems = (followed: string) => {
    if (!items) return null
    const pattern = wordPattern(followed)
    return items.filter(
      item =>
        item.publishedAt !== null &&
        now - new Date(item.publishedAt).getTime() < WEEK_MS &&
        pattern.test(foldText(`${item.title} ${item.summary}`))
    )
  }

  return (
    <SectionPage title={t('settings.nav.followed')} intro={t('settings.followed.intro')} layout={layout}>
      <WordForm
        words={followedWords}
        onAdd={word => updatePreferences({ followedWords: [...followedWords, word] })}
        placeholder={t('settings.followed.placeholder')}
        label={t('settings.followed.field')}
        action={t('settings.followed.add')}
      />

      {followedWords.length === 0 ? (
        <EmptyCard
          icon={<Activity size={18} />}
          title={t('settings.followed.emptyTitle')}
          hint={t('settings.followed.emptyHint')}
        />
      ) : (
        <ul className={styles.card}>
          {followedWords.map(followed => {
            const count = weekItems(followed)
            const alert = notifications.enabled && !notifications.silentWords.includes(followed)
            return (
              <SettingRow
                key={followed}
                as="li"
                lead={
                  <span className={`${styles.tile} ${styles.rustTile}`}>
                    <Activity size={18} aria-hidden="true" />
                  </span>
                }
                label={followed}
                hint={
                  count === null
                    ? t('settings.followed.searching')
                    : count.length === 0
                      ? t('settings.followed.nothingThisWeek')
                      : t('settings.followed.thisWeek', { count: countByKind(count) })
                }
              >
                <span className={`${styles.mono} ${followedStyles.alert}`}>
                  <Bell size={13} aria-hidden="true" />
                  {t('settings.followed.alert')}
                </span>
                <Toggle
                  label={t('settings.followed.alertFor', { word: followed })}
                  checked={alert}
                  disabled={!notifications.enabled}
                  onChange={on =>
                    updateNotificationSettings({
                      silentWords: on
                        ? notifications.silentWords.filter(other => other !== followed)
                        : [...notifications.silentWords, followed]
                    })
                  }
                />
                <RoundButton
                  icon={X}
                  size={34}
                  label={t('settings.followed.unfollow', { word: followed })}
                  onClick={() =>
                    updatePreferences({ followedWords: followedWords.filter(other => other !== followed) })
                  }
                />
              </SettingRow>
            )
          })}
        </ul>
      )}

      {/* The alerts are about followed subjects: nothing to pause before the first one. */}
      {!notifications.enabled && followedWords.length > 0 && (
        <Notice icon={BellOff} title={t('settings.followed.pausedTitle')}>
          <Trans i18nKey="settings.followed.paused" components={{ link: <a href={settingsHref('notifications')} /> }} />
        </Notice>
      )}
    </SectionPage>
  )
}

export default FollowedSection
