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
import { HISTORY_LINK, type Section, useMainLinks, useNavCounts } from './nav.ts'
import styles from './Sidebar.module.css'

interface SidebarProps {
  // The section or topic shown, highlighted.
  active: Section | 'search' | string | null
  topics: TopicSummary[] | null
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
          {[...links, HISTORY_LINK].map(({ id, href, icon: Icon }) => {
            const label = t(`nav.${id}`)
            const count =
              id === 'saved' ? counts.saved : id === 'followed' ? counts.followed : id === 'shares' ? counts.shares : 0
            return (
              <li key={id}>
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
                    <span
                      className={`${styles.count} ${id === 'saved' ? '' : id === 'shares' ? styles.info : styles.accent}`}
                    >
                      {count}
                    </span>
                  )}
                  {/* Nothing sent left to open: the last emoji received. */}
                  {id === 'shares' && count === 0 && active !== id && counts.reaction && (
                    <span className={`${styles.count} ${styles.reaction}`} aria-label={t('nav.newReaction')}>
                      {counts.reaction}
                    </span>
                  )}
                </a>
              </li>
            )
          })}
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
        {/* A parent's wheel counts the teens' requests waiting for an answer. Open, it is filled like the phone's active
            tab, and the requests show on top of the list instead of the count. */}
        <span className={styles.settings}>
          <RoundButton
            icon={Settings}
            label={
              counts.requests > 0
                ? t('nav.newCount', { label: t('nav.settings'), count: counts.requests })
                : t('nav.settings')
            }
            size={44}
            href={SETTINGS_HREF}
            variant={active === 'settings' ? 'on' : 'default'}
          />
          {counts.requests > 0 && active !== 'settings' && (
            <span className={styles.settingsBadge} aria-hidden="true">
              {counts.requests}
            </span>
          )}
        </span>
      </div>
    </nav>
  )
}

export default Sidebar
