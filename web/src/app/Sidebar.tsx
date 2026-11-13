import { House, Search, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TopicSummary } from '../api.ts'
import Logo from '../ui/Logo.tsx'
import ProfileButton from '../ui/ProfileButton.tsx'
import ProfileSwitcher from './ProfileSwitcher.tsx'
import { SETTINGS_HREF, searchHref, topicHref } from '../lib/use-hash-route.ts'
import RoundButton from '../ui/RoundButton.tsx'
import ScrollArea from '../ui/ScrollArea.tsx'
import TopicIcon from '../ui/TopicIcon.tsx'
import { HISTORY_LINK, type NavLink, type Section, countOf, useMainLinks, useNavCounts } from './nav.ts'
import styles from './Sidebar.module.css'

interface SidebarProps {
  // The section or topic shown, highlighted.
  active: Section | 'search' | string | null
  topics: TopicSummary[] | null
}

const COUNT_TONES: Partial<Record<Section, string | undefined>> = { saved: '', shares: styles.info }

// A main list's link, with its counter, or the last emoji received on "Partages" when nothing sent is left to open.
const SectionLink = ({
  link,
  active,
  counts
}: {
  link: NavLink
  active: SidebarProps['active']
  counts: ReturnType<typeof useNavCounts>
}) => {
  const { t } = useTranslation()
  const { id, href, icon: Icon } = link
  const label = t(`nav.${id}`)
  const count = countOf(id, counts)
  return (
    <li>
      <a
        className={styles.link}
        href={href}
        title={label}
        aria-current={active === id ? 'page' : undefined}
        data-tour={href === '#/' ? 'feed' : undefined}
      >
        <span className={styles.square}>
          <Icon size={14} aria-hidden="true" />
        </span>
        <span className={styles.label}>{label}</span>
        {count > 0 && active !== id && (
          <span className={`${styles.count} ${COUNT_TONES[id] ?? styles.accent}`}>{count}</span>
        )}
        {id === 'shares' && count === 0 && active !== id && counts.reaction && (
          <span className={`${styles.count} ${styles.reaction}`} aria-label={t('nav.newReaction')}>
            {counts.reaction}
          </span>
        )}
      </a>
    </li>
  )
}

// A parent's wheel counts the teens' requests waiting for an answer. Open, it is filled like the phone's active tab,
// and the requests show on top of the list instead of the count.
const SettingsButton = ({ active, requests }: { active: SidebarProps['active']; requests: number }) => {
  const { t } = useTranslation()
  return (
    <span className={styles.settings}>
      <RoundButton
        icon={Settings}
        label={requests > 0 ? t('nav.newCount', { label: t('nav.settings'), count: requests }) : t('nav.settings')}
        size={44}
        href={SETTINGS_HREF}
        variant={active === 'settings' ? 'on' : 'default'}
      />
      {requests > 0 && active !== 'settings' && (
        <span className={styles.settingsBadge} aria-hidden="true">
          {requests}
        </span>
      )}
    </span>
  )
}

// Desktop and tablets across: the main lists and the history, then the topics.
const Sidebar = ({ active, topics }: SidebarProps) => {
  const { t } = useTranslation()
  const counts = useNavCounts()
  const links = useMainLinks()

  return (
    <nav className={styles.sidebar} aria-label={t('nav.main')} data-tabs>
      <div className={styles.header}>
        <a href="#/" className={styles.logo} aria-label={t('nav.home')}>
          <Logo />
        </a>
        <div className={styles.actions}>
          <ProfileButton size={44} />
          {/* In the search, the search button takes you home. */}
          {active === 'search' ? (
            <RoundButton icon={House} label={t('nav.backHome')} size={44} href="#/" />
          ) : (
            <RoundButton icon={Search} label={t('nav.search')} size={44} href={searchHref()} />
          )}
        </div>
      </div>
      <div className={styles.rule} />

      <ScrollArea className={styles.scroll}>
        <ul className={styles.links}>
          {[...links, HISTORY_LINK].map(link => (
            <SectionLink key={link.id} link={link} active={active} counts={counts} />
          ))}
        </ul>

        <div className={styles.divider} />
        <span className={styles.heading}>{t('nav.topics')}</span>
        <ul className={styles.links}>
          {topics?.map(topic => (
            <li key={topic.id}>
              <a
                className={styles.link}
                href={topicHref(topic.id)}
                data-topic={topic.id}
                title={topic.label}
                aria-current={active === topic.id ? 'page' : undefined}
              >
                <span className={`${styles.square} ${styles.topicSquare}`}>
                  <TopicIcon topicId={topic.id} size={14} />
                </span>
                <span className={styles.label}>{topic.label}</span>
              </a>
            </li>
          ))}
        </ul>
      </ScrollArea>

      {/* Out of the header, which keeps room to breathe: the profile's selector and, beside it, the settings. One
          row, so the line above it meets the list column's foot line. */}
      <div className={styles.footer}>
        <ProfileSwitcher />
        <SettingsButton active={active} requests={counts.requests} />
      </div>
    </nav>
  )
}

export default Sidebar
