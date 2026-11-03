import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { searchHref } from '../lib/use-hash-route.ts'
import { SETTINGS_LINK, type Section, useMainLinks, useNavCounts } from './nav.ts'
import styles from './MobileNav.module.css'

// Phones: a floating pill with the sections (Partages too in a household that shares), and the search beside it.
const MobileNav = ({ active }: { active: Section | 'search' | null }) => {
  const { t } = useTranslation()
  const counts = useNavCounts()
  const links = useMainLinks()

  return (
    <>
      <div className={styles.fade} aria-hidden="true" />
      <div className={styles.bar}>
        <nav className={`${styles.pill} ${styles.glass}`} aria-label={t('nav.label')}>
          {[...links, SETTINGS_LINK].map(({ id, href, icon: Icon }) => {
            const label = t(`nav.${id}`)
            // As in the sidebar: how many are saved (neutral), how many followed articles are new (rust), how many shares (blue).
            const count =
              id === 'saved'
                ? counts.saved
                : id === 'followed'
                  ? counts.followed
                  : id === 'shares'
                    ? counts.shares
                    : id === 'settings'
                      ? counts.requests
                      : 0
            const badge = active !== id ? count : 0
            const reaction = id === 'shares' && active !== id && badge === 0 ? counts.reaction : null
            return (
              <a
                key={id}
                className={styles.item}
                href={href}
                aria-label={
                  badge
                    ? t(id === 'saved' ? 'nav.savedCount' : 'nav.newCount', { label, count: badge })
                    : reaction
                      ? t('nav.newReactionOn', { label, reaction })
                      : label
                }
                aria-current={active === id ? 'page' : undefined}
                data-tour={href === '#/' ? 'feed' : undefined}
              >
                <Icon size={18} aria-hidden="true" />
                {badge > 0 && (
                  <span
                    className={`${styles.badge} ${id === 'saved' ? styles.neutral : id === 'shares' ? styles.info : ''}`}
                  >
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
                {reaction && (
                  <span className={`${styles.badge} ${styles.reaction}`} aria-hidden="true">
                    {reaction}
                  </span>
                )}
              </a>
            )
          })}
        </nav>
        <a
          className={`${styles.search} ${styles.glass}`}
          href={searchHref()}
          aria-label={t('nav.search')}
          aria-current={active === 'search' ? 'page' : undefined}
        >
          <Search size={18} aria-hidden="true" />
        </a>
      </div>
    </>
  )
}

export default MobileNav
