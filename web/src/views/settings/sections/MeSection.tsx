import { RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { askToConfirm } from '../../../lib/confirm.ts'
import { useCountdown, useLimits } from '../../../lib/limits.ts'
import { resetPreferences } from '../../../lib/preferences.ts'
import { editProfile, isYoung, useProfiles } from '../../../lib/profiles.ts'
import { clearReadings } from '../../../lib/reading-stats.ts'
import { showDone, showSaved } from '../../../lib/toast.ts'
import { startTour } from '../../../lib/tour.ts'
import Button from '../../../ui/Button.tsx'
import Chip from '../../../ui/Chip.tsx'
import Dialog from '../../../ui/Dialog.tsx'
import ProfileAvatarButton from '../../../ui/ProfileAvatarButton.tsx'
import PinSettings from '../../profiles/PinSettings.tsx'
import ProfileForm from '../../profiles/ProfileForm.tsx'
import RichText from '../../../ui/RichText.tsx'
import SectionPage from '../SectionPage.tsx'
import RowsSkeleton from '../SettingsSkeleton.tsx'
import SettingRow from '../SettingRow.tsx'
import styles from '../Settings.module.css'
import { formatMinutes } from './young/format.ts'

// "00:34:52": the time left, every second.
const clock = (seconds: number) =>
  [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60]
    .map(part => String(part).padStart(2, '0'))
    .join(':')

// Réglages > Ton profil: the open profile's own things, gathered from Profils, Lecture and Compte.
const MeSection = ({ layout }: { layout: 'desktop' | 'phone' }) => {
  const { t } = useTranslation()
  const value = useProfiles({ fresh: true })
  const [editing, setEditing] = useState(false)
  const own = value?.profiles.find(profile => profile.id === value.current)
  const limits = useLimits()
  const left = useCountdown()
  const daily = limits?.limits.rules.dailyMinutes ?? null
  const title = t('settings.nav.me')
  const intro = own && isYoung(own) ? t('limits.meIntro') : t('settings.me.intro')

  if (!own)
    return (
      <SectionPage title={title} intro={intro} layout={layout}>
        <RowsSkeleton rows={1} lead="round" end="button" />
      </SectionPage>
    )

  return (
    <SectionPage title={title} intro={intro} layout={layout}>
      <div className={styles.card}>
        <div className={styles.row}>
          <ProfileAvatarButton profile={own} size={44} />
          <span className={styles.rowText}>
            <span className={styles.rowLabel}>{own.name}</span>
            {/* A young profile's kind is its badge, as on its parents' page. */}
            {!isYoung(own) && (
              <span className={styles.rowHint}>
                {own.role === 'admin' ? t('settings.roles.admin') : t(`profileForm.kinds.${own.kind}`)}
                {own.locked ? ` · ${t('profiles.private')}` : ''}
              </span>
            )}
          </span>
          {isYoung(own) && <Chip size="row">{t(`profileForm.kinds.${own.kind}`)}</Chip>}
          <Button compact onClick={() => setEditing(true)} aria-label={t('settings.editName', { name: own.name })}>
            {t('settings.edit')}
          </Button>
        </div>
      </div>

      {/* A young profile has no code of its own: its parents open it. Its time of the day instead, counted down. */}
      {!isYoung(own) && <PinSettings profile={own} />}
      {daily !== null && left !== null && (
        <>
          <h2 className={styles.label}>{t('limits.today')}</h2>
          <div className={styles.card}>
            <SettingRow label={t('limits.readingTime')} hint={t('limits.readingHint', { time: formatMinutes(daily) })}>
              <Chip tone="warning" size="row" label={t('limits.left', { time: clock(left) })}>
                {clock(left)}
              </Chip>
            </SettingRow>
          </div>
        </>
      )}

      {/* A child's tour will come with its own interface; a teen's shows how to ask for a source. */}
      {own.kind !== 'child' && (
        <>
          <h2 className={styles.label}>{t('settings.me.help')}</h2>
          <div className={styles.card}>
            <SettingRow
              label={t('settings.me.tour')}
              hint={own.kind === 'teen' ? t('settings.me.tourHintTeen') : t('settings.me.tourHint')}
            >
              <Button compact onClick={startTour}>
                {t('settings.me.replay')}
              </Button>
            </SettingRow>
          </div>
        </>
      )}

      <h2 className={styles.label}>{t('settings.me.reset')}</h2>
      <div className={styles.card}>
        <SettingRow label={t('nav.settings')} hint={t('settings.me.resetSettingsHint')}>
          <Button
            look="danger"
            icon={RotateCcw}
            onClick={() =>
              askToConfirm({
                title: t('confirm.resetSettings.title'),
                message: <RichText i18nKey="confirm.resetSettings.message" />,
                label: t('confirm.resetSettings.button'),
                onConfirm: () => {
                  resetPreferences()
                  showDone(t('settings.me.resetSettingsDone'))
                }
              })
            }
          >
            {t('settings.me.resetAction')}
          </Button>
        </SettingRow>
        <SettingRow label={t('settings.me.clearStats')} hint={t('settings.me.clearStatsHint')}>
          <Button
            look="danger"
            icon={Trash2}
            onClick={() =>
              askToConfirm({
                title: t('confirm.clearStats.title'),
                message: <RichText i18nKey="confirm.clearStats.message" />,
                label: t('confirm.clearStats.button'),
                onConfirm: () => {
                  clearReadings()
                  showDone(t('settings.me.clearStatsDone'))
                }
              })
            }
          >
            {t('settings.me.clearAction')}
          </Button>
        </SettingRow>
      </div>

      <Dialog open={editing} onClose={() => setEditing(false)} title={t('settings.editProfileTitle')}>
        {editing && (
          <ProfileForm
            profile={own}
            nameFixed={isYoung(own)}
            onCancel={() => setEditing(false)}
            onSave={async ({ name, color, photo, avatar }) => {
              // A young profile's name is its parents' to change.
              await editProfile(own.id, isYoung(own) ? { color, avatar } : { name, color }, photo)
              setEditing(false)
              showSaved(t('settings.profileSaved'))
            }}
          />
        )}
      </Dialog>
    </SectionPage>
  )
}

export default MeSection
