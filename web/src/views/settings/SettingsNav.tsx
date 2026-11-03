import {
  Activity,
  ChartColumn,
  ChevronRight,
  CircleUser,
  Database,
  EyeOff,
  Bell,
  House,
  Info,
  Keyboard,
  Layers,
  LogOut,
  type LucideIcon,
  Rss,
  Send,
  Type,
  Users
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNotificationSettings } from '../../lib/notifications.ts'
import { usePreferences } from '../../lib/preferences.ts'
import { useMyRequests } from '../../lib/my-requests.ts'
import { usePendingRequests } from '../../lib/requests.ts'
import { useSourceAnswers } from '../../lib/source-answers.ts'
import { isYoung, useProfiles } from '../../lib/profiles.ts'
import { callsLeft, sourceState, useAiUsage, useSourceStatuses } from '../../lib/settings-data.ts'
import { type SettingsSection, settingsHref, useHashRoute } from '../../lib/use-hash-route.ts'
import PhoneHeader from '../../ui/PhoneHeader.tsx'
import ScrollArea from '../../ui/ScrollArea.tsx'
import SparkleIcon from '../../ui/SparkleIcon.tsx'
import columnStyles from '../ListColumn.module.css'
import RequestDialog from './RequestDialog.tsx'
import RequestAnswers from './RequestAnswers.tsx'
import RequestsPile from './RequestsPile.tsx'
import styles from './SettingsNav.module.css'

interface Entry {
  id: SettingsSection
  label: string
  hint: string
  icon: LucideIcon | 'ai'
  // Keyboard shortcuts mean nothing on a phone.
  desktopOnly?: boolean
  // Sharing means nothing in a household of one; the household's own settings are the admin's.
  hidden?: boolean
}

// The sections of the settings, in five groups (what is read, about what, by whom, for the household, here), with what each one holds right now.
const useGroups = (onUnauthorized: () => void): { id: string; label: string; hidden?: boolean; entries: Entry[] }[] => {
  const preferences = usePreferences()
  const notifications = useNotificationSettings()
  const sources = useSourceStatuses(onUnauthorized).value
  const usage = useAiUsage(onUnauthorized).value
  const household = useProfiles({ onError: () => {} })
  const profile = household?.profiles.find(entry => entry.id === household.current)
  // As the "En erreur" filter of Réglages › Sources: a hidden source's error is not this profile's concern.
  const failing =
    sources?.filter(source => sourceState(source) === 'error' && !preferences.hiddenSources.includes(source.id))
      .length ?? 0
  const { t } = useTranslation()
  // A young profile's settings are its own: the household's (Foyer, Profils, IA) are its parents'.
  const young = profile ? isYoung(profile) : false
  const asked = useMyRequests(profile?.kind === 'teen')?.length ?? 0

  return [
    {
      id: 'reading',
      label: t('settings.groups.reading'),
      entries: [
        { id: 'reading', label: t('settings.nav.reading'), hint: t('settings.hints.reading'), icon: Type },
        { id: 'themes', label: t('settings.nav.themes'), hint: t('settings.hints.themes'), icon: Layers },
        {
          id: 'sources',
          label: t('settings.nav.sources'),
          hint: sources
            ? `${t('count.source', { count: sources.length })}${failing ? `, ${t('settings.hints.failing', { count: failing })}` : ''}${asked ? ` · ${t('requests.count', { count: asked })}` : ''}`
            : t('settings.hints.sources'),
          icon: Rss
        }
      ]
    },
    {
      id: 'subjects',
      label: t('settings.groups.subjects'),
      entries: [
        {
          id: 'followed',
          label: t('settings.nav.followed'),
          hint: preferences.followedWords.length
            ? t('count.subject', { count: preferences.followedWords.length })
            : t('settings.hints.none'),
          icon: Activity
        },
        {
          id: 'muted',
          label: t('settings.nav.muted'),
          hint: preferences.mutedWords.length
            ? t('count.word', { count: preferences.mutedWords.length })
            : t('settings.hints.none'),
          icon: EyeOff
        }
      ]
    },
    {
      id: 'you',
      label: t('settings.groups.you'),
      entries: [
        {
          id: 'me',
          label: t('settings.nav.me'),
          hint: young ? t('limits.meHint') : t('settings.hints.me'),
          icon: CircleUser
        },
        { id: 'stats', label: t('settings.nav.stats'), hint: t('settings.hints.stats'), icon: ChartColumn },
        {
          id: 'sharing',
          label: t('settings.nav.sharing'),
          hint: t(preferences.sharing ? 'settings.hints.on' : 'settings.hints.off'),
          icon: Send,
          hidden: (household?.profiles.length ?? 0) < 2
        }
      ]
    },
    {
      id: 'household',
      label: t('settings.groups.household'),
      hidden: young,
      entries: [
        {
          id: 'household',
          label: t('settings.nav.household'),
          hint: t('settings.hints.household'),
          icon: House,
          hidden: profile?.role !== 'admin'
        },
        {
          id: 'profiles',
          label: t('settings.nav.profiles'),
          hint:
            household && profile
              ? `${profile.name} · ${t('count.profile', { count: household.profiles.length })}`
              : t('profiles.who'),
          icon: Users
        },
        {
          id: 'ai',
          label: t('settings.nav.ai'),
          hint: usage
            ? usage.available
              ? t('settings.hints.callsLeft', { count: callsLeft(usage) })
              : t('settings.hints.aiOff')
            : t('settings.hints.ai'),
          icon: 'ai'
        }
      ]
    },
    {
      id: 'device',
      label: t('settings.groups.device'),
      entries: [
        {
          id: 'notifications',
          label: t('settings.nav.notifications'),
          hint: t(notifications.enabled ? 'settings.hints.onPlural' : 'settings.hints.offPlural'),
          icon: Bell
        },
        { id: 'account', label: t('settings.nav.account'), hint: t('settings.hints.account'), icon: Database },
        {
          id: 'shortcuts',
          label: t('settings.nav.shortcuts'),
          hint: t('settings.hints.shortcuts'),
          icon: Keyboard,
          desktopOnly: true
        }
      ]
    },
    {
      id: 'about',
      label: t('settings.groups.about'),
      entries: [{ id: 'about', label: t('settings.nav.about'), hint: t('settings.hints.about'), icon: Info }]
    }
  ]
}

const EntryIcon = ({ icon }: { icon: Entry['icon'] }) => {
  if (icon === 'ai')
    return (
      <span className={styles.icon}>
        <SparkleIcon size={18} />
      </span>
    )
  const Icon = icon
  return (
    <span className={styles.icon}>
      <Icon size={18} aria-hidden="true" />
    </span>
  )
}

interface SettingsNavProps {
  layout: 'desktop' | 'phone'
  active: SettingsSection | null
  onLogout: () => void
  onUnauthorized: () => void
}

// The list of settings: a column beside the open section on a computer, the settings' home on a phone.
const SettingsNav = ({ layout, active, onLogout, onUnauthorized }: SettingsNavProps) => {
  const { t } = useTranslation()
  const groups = useGroups(onUnauthorized).filter(group => !group.hidden)
  const household = useProfiles({ onError: () => {} })
  const profile = household?.profiles.find(entry => entry.id === household.current)
  // A young profile does not log the household's device out.
  const young = profile ? isYoung(profile) : false
  const isPhone = layout === 'phone'
  // A teen's requests wait on top for a parent, and one opens from its card or its notification.
  const requests = usePendingRequests(profile?.kind === 'adult')
  const route = useHashRoute()
  const opened = route.name === 'settings' && profile?.kind === 'adult' ? route.request : undefined
  // A teen's answered requests, until it leaves Réglages.
  const answers = useSourceAnswers(profile?.kind === 'teen')
  const top = (
    <>
      {requests.length > 0 && (
        <section className={styles.group} aria-label={t('requests.waitingTitle')}>
          <h2 className={styles.groupLabel}>{t('requests.waitingTitle')}</h2>
          <RequestsPile requests={requests} />
        </section>
      )}
      {answers.length > 0 && (
        <section className={styles.group} aria-label={t('requests.answers')}>
          <h2 className={styles.groupLabel}>{t('requests.answers')}</h2>
          <RequestAnswers answers={answers} />
        </section>
      )}
      {opened !== undefined && <RequestDialog key={opened} requestId={opened} />}
    </>
  )

  const list = groups.map(group => (
    <section key={group.id} className={styles.group} aria-label={group.label}>
      <h2 className={styles.groupLabel}>{group.label}</h2>
      <ul className={styles.entries}>
        {group.entries
          .filter(entry => !(isPhone && entry.desktopOnly) && !entry.hidden)
          .map(entry => (
            <li key={entry.id}>
              <a
                className={`${styles.entry} ${entry.id === active ? styles.active : ''}`}
                href={settingsHref(entry.id)}
                aria-current={entry.id === active ? 'page' : undefined}
              >
                <EntryIcon icon={entry.icon} />
                <span className={styles.text}>
                  <span className={styles.label}>{entry.label}</span>
                  <span className={styles.hint}>{entry.hint}</span>
                </span>
                {isPhone && <ChevronRight size={16} aria-hidden="true" className={styles.chevron} />}
              </a>
            </li>
          ))}
        {/* One click from anywhere in the settings, at the list's foot. */}
        {group.id === 'device' && !young && (
          <li>
            <button type="button" className={`${styles.entry} ${styles.logout}`} onClick={onLogout}>
              <span className={styles.icon}>
                <LogOut size={18} aria-hidden="true" />
              </span>
              <span className={styles.label}>{t('settings.logout')}</span>
            </button>
          </li>
        )}
      </ul>
    </section>
  ))

  if (isPhone)
    return (
      <section className={`${styles.nav} ${styles.phone}`} aria-label={t('nav.settings')}>
        <PhoneHeader title={t('nav.settings')} />
        <div className={styles.groups}>
          {top}
          {list}
        </div>
      </section>
    )

  return (
    <nav className={columnStyles.column} aria-label={t('nav.settings')}>
      {/* The header of every list column: the title and its dot, a 2px line under it, the list alone scrolls. */}
      <div className={columnStyles.header}>
        <h1 className={`${columnStyles.title} screen-title`}>{t('nav.settings')}</h1>
      </div>
      <div className={columnStyles.line} aria-hidden="true" />
      <ScrollArea className={columnStyles.scroll}>
        <div className={`${styles.nav} ${styles.desktop}`}>
          {top}
          {list}
        </div>
      </ScrollArea>
    </nav>
  )
}

export default SettingsNav
