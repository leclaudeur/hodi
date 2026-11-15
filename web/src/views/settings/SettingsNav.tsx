import { ChevronRight, LogOut } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { usePendingRequests } from '../../lib/requests.ts'
import { useSourceAnswers } from '../../lib/source-answers.ts'
import { isYoung, useProfiles } from '../../lib/profiles.ts'
import { type SettingsSection, settingsHref, useHashRoute } from '../../lib/use-hash-route.ts'
import PhoneHeader from '../../ui/PhoneHeader.tsx'
import ScrollArea from '../../ui/ScrollArea.tsx'
import SparkleIcon from '../../ui/SparkleIcon.tsx'
import columnStyles from '../ListColumn.module.css'
import RequestDialog from './RequestDialog.tsx'
import RequestAnswers from './RequestAnswers.tsx'
import RequestsPile from './RequestsPile.tsx'
import styles from './SettingsNav.module.css'
import { type Entry, type Group, useGroups } from './settings-groups.tsx'

const EntryIcon = ({ icon }: { icon: Entry['icon'] }) => {
  if (icon === 'ai')
    return (
      <span className={styles.icon}>
        <SparkleIcon size={18} />
      </span>
    )
  const Icon = icon
  return (
    <span className={styles.icon} aria-hidden="true">
      <Icon size={18} />
    </span>
  )
}

interface NavGroupProps {
  group: Group
  current: string | null
  isPhone: boolean
  // The device's group ends with « Se déconnecter », but for a young profile.
  logout?: () => void
}

const NavGroup = ({ group, current, isPhone, logout }: NavGroupProps) => {
  const { t } = useTranslation()
  return (
    <section className={styles.group} aria-label={group.label}>
      <h2 className={styles.groupLabel}>{group.label}</h2>
      <ul className={styles.entries}>
        {group.entries
          .filter(entry => !(isPhone && entry.desktopOnly) && !entry.hidden)
          .map(entry => (
            <li key={entry.id}>
              <a
                className={`${styles.entry} ${entry.id === current ? styles.active : ''}`}
                href={entry.href ?? settingsHref(entry.id as SettingsSection)}
                aria-current={entry.id === current ? 'page' : undefined}
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
        {logout && (
          <li>
            <button type="button" className={`${styles.entry} ${styles.logout}`} onClick={logout}>
              <span className={styles.icon}>
                <LogOut size={18} aria-hidden="true" />
              </span>
              <span className={styles.label}>{t('settings.logout')}</span>
            </button>
          </li>
        )}
      </ul>
    </section>
  )
}

interface SettingsNavProps {
  layout: 'desktop' | 'phone'
  active: SettingsSection | null
  // The open section's item: which plugin's page is open.
  activeItem?: string
  onLogout: () => void
  onUnauthorized: () => void
}

// The list of settings: a column beside the open section on a computer, the settings' home on a phone.
const SettingsNav = ({ layout, active, activeItem, onLogout, onUnauthorized }: SettingsNavProps) => {
  const { t } = useTranslation()
  const groups = useGroups(onUnauthorized).filter(group => !group.hidden)
  const household = useProfiles({ onError: () => {} })
  const profile = household?.profiles.find(entry => entry.id === household.current)
  // A young profile does not log the household's device out.
  const young = profile ? isYoung(profile) : false
  const isPhone = layout === 'phone'
  const current = active === 'plugin' && activeItem ? `plugin:${activeItem}` : active
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
    <NavGroup
      key={group.id}
      group={group}
      current={current}
      isPhone={isPhone}
      logout={group.id === 'device' && !young ? onLogout : undefined}
    />
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
