import { BellOff, Moon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { UnauthorizedError } from '../../../api.ts'
import {
  disableNotifications,
  enableNotifications,
  getPushKey,
  notificationSupport,
  testNotification,
  updateNotificationSettings,
  useNotificationSettings
} from '../../../lib/notifications.ts'
import { useLimits } from '../../../lib/limits.ts'
import { usePreferences } from '../../../lib/preferences.ts'
import { showSaved } from '../../../lib/toast.ts'
import { settingsHref } from '../../../lib/use-hash-route.ts'
import Button from '../../../ui/Button.tsx'
import Chip from '../../../ui/Chip.tsx'
import Notice from '../../../ui/Notice.tsx'
import StatusLine from '../../../ui/StatusLine.tsx'
import TimeRangeField from '../../../ui/TimeRangeField.tsx'
import Toggle from '../../../ui/Toggle.tsx'
import SectionPage from '../SectionPage.tsx'
import SettingRow from '../SettingRow.tsx'
import styles from '../Settings.module.css'
import notificationStyles from './NotificationsSection.module.css'
import { formatRange } from './young/format.ts'

interface NotificationsSectionProps {
  layout: 'desktop' | 'phone'
  onUnauthorized: () => void
}

// Notifications on this device: on or off, what sends one, and the quiet hours.
const NotificationsSection = ({ layout, onUnauthorized }: NotificationsSectionProps) => {
  const { t } = useTranslation()
  const settings = useNotificationSettings()
  const preferences = usePreferences()
  const { followedWords } = preferences
  const supported = notificationSupport() === 'supported'
  // Null until the server says whether it can send them.
  const [available, setAvailable] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const quiet = settings.quietStart !== settings.quietEnd
  // A young profile's quiet hours are its parents': shown, not changed.
  const limits = useLimits()

  useEffect(() => {
    if (!supported) return
    let active = true
    getPushKey()
      .then(key => active && setAvailable(key !== null))
      .catch((error: unknown) => {
        if (error instanceof UnauthorizedError) onUnauthorized()
      })
    return () => {
      active = false
    }
  }, [supported, onUnauthorized])

  const toggle = async () => {
    setBusy(true)
    setMessage(null)
    try {
      if (settings.enabled) {
        await disableNotifications()
        showSaved(t('settings.notifications.disabled'))
      } else {
        const result = await enableNotifications()
        if (result !== 'enabled') setMessage(t(`settings.notifications.errors.${result}`))
        else showSaved(t('settings.notifications.enabled'))
      }
    } catch (error) {
      if (error instanceof UnauthorizedError) onUnauthorized()
      else setMessage(t('settings.notifications.errors.failed'))
    } finally {
      setBusy(false)
    }
  }

  const status = !supported ? (
    <Notice icon={BellOff} title={t('settings.notifications.unsupportedTitle')}>
      {t('settings.notifications.unsupported')}
    </Notice>
  ) : (
    <SettingRow
      label={t(settings.enabled ? 'settings.notifications.onHere' : 'settings.notifications.offHere')}
      hint={t(available === false ? 'settings.notifications.errors.unavailable' : 'settings.notifications.perDevice')}
    >
      <Toggle
        label={t('settings.notifications.toggle')}
        checked={settings.enabled}
        disabled={busy || available !== true}
        onChange={() => void toggle()}
      />
    </SettingRow>
  )

  return (
    <SectionPage title={t('settings.nav.notifications')} intro={t('settings.notifications.intro')} layout={layout}>
      {supported ? (
        <div className={styles.card}>
          {status}
          {limits && (
            <SettingRow label="Ne pas déranger" hint={t('limits.quietHint')}>
              <Chip tone="warning" size="row">
                {limits.limits.rules.quiet ? formatRange(limits.limits.rules.quiet) : t('limits.quietNone')}
              </Chip>
            </SettingRow>
          )}
          {/* On its own row: beside the switch, it squeezed the text on a phone. */}
          {settings.enabled && (
            <SettingRow label={t('settings.notifications.test')} hint={t('settings.notifications.testHint')}>
              <Button onClick={() => void testNotification().catch(() => {})}>
                {t('settings.notifications.testAction')}
              </Button>
            </SettingRow>
          )}
        </div>
      ) : (
        status
      )}
      {message && <StatusLine tone="error">{message}</StatusLine>}

      {settings.enabled && (
        <>
          <h2 className={styles.label}>{t('settings.notifications.triggers')}</h2>
          <div className={styles.card}>
            <a className={`${styles.row} ${notificationStyles.link}`} href={settingsHref('followed')}>
              <span className={styles.rowText}>
                <span className={styles.rowLabel}>{t('settings.nav.followed')}</span>
                <span className={styles.rowHint}>
                  {followedWords.length === 0
                    ? t('settings.notifications.noSubject')
                    : t('settings.notifications.subjects', {
                        alerts: followedWords.filter(word => !settings.silentWords.includes(word)).length,
                        total: followedWords.length
                      })}
                </span>
              </span>
            </a>
            {preferences.sharing && (
              <SettingRow label={t('settings.notifications.shares')} hint={t('settings.notifications.sharesHint')}>
                <Toggle
                  label={t('settings.notifications.shares')}
                  checked={settings.shares}
                  onChange={shares => updateNotificationSettings({ shares })}
                />
              </SettingRow>
            )}
            {preferences.sharing && (
              <SettingRow
                label={t('settings.notifications.reactions')}
                hint={t('settings.notifications.reactionsHint')}
              >
                <Toggle
                  label={t('settings.notifications.reactions')}
                  checked={settings.reactions}
                  onChange={reactions => updateNotificationSettings({ reactions })}
                />
              </SettingRow>
            )}
            <SettingRow label={t('settings.notifications.badge')} hint={t('settings.notifications.badgeHint')}>
              <Toggle
                label={t('settings.notifications.badge')}
                checked={settings.badge}
                onChange={badge => updateNotificationSettings({ badge })}
              />
            </SettingRow>
          </div>

          {/* A young profile's quiet hours are on the card above. */}
          {!limits && (
            <>
              <h2 className={styles.label}>{t('settings.notifications.silence')}</h2>
              <div className={styles.card}>
                <SettingRow label={t('settings.notifications.dnd')} hint={t('settings.notifications.dndHint')}>
                  <Toggle
                    label={t('settings.notifications.dnd')}
                    checked={quiet}
                    onChange={on =>
                      updateNotificationSettings(
                        on ? { quietStart: '22:00', quietEnd: '07:00' } : { quietEnd: settings.quietStart }
                      )
                    }
                  />
                </SettingRow>
                {/* The hours on their own row, so the text keeps its width. */}
                {quiet && (
                  <SettingRow label={t('settings.notifications.hours')}>
                    <TimeRangeField
                      icon={Moon}
                      start={settings.quietStart}
                      end={settings.quietEnd}
                      startLabel={t('settings.notifications.start')}
                      endLabel={t('settings.notifications.end')}
                      onChange={range => updateNotificationSettings({ quietStart: range.start, quietEnd: range.end })}
                    />
                  </SettingRow>
                )}
              </div>
            </>
          )}
        </>
      )}
    </SectionPage>
  )
}

export default NotificationsSection
