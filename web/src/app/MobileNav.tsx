import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { searchHref } from '../lib/use-hash-route.ts'
import { SETTINGS_LINK, type NavLink, type Section, countOf, useMainLinks, useNavCounts } from './nav.ts'
import styles from './MobileNav.module.css'

const BADGE_TONES: Partial<Record<Section, string | undefined>> = { saved: styles.neutral, shares: styles.info }

type Active = Section | 'search' | null

// A section's tab, with its counter, or the last reaction on "Partages" when nothing is left to open.
const NavItem = ({
  link,
  active,
  counts
}: {
  link: NavLink
  active: Active
  counts: ReturnType<typeof useNavCounts>
}) => {
  const { t } = useTranslation()
  const { id, href, icon: Icon } = link
  const label = t(`nav.${id}`)
  // As in the sidebar: how many are saved (neutral), how many followed articles are new (rust), how many shares (blue).
  const badge = active !== id ? countOf(id, counts) : 0
  const reaction = id === 'shares' && active !== id && badge === 0 ? counts.reaction : null
  let ariaLabel = label
  if (badge) ariaLabel = t(id === 'saved' ? 'nav.savedCount' : 'nav.newCount', { label, count: badge })
  else if (reaction) ariaLabel = t('nav.newReactionOn', { label, reaction })
  return (
    <a
      className={styles.item}
      href={href}
      aria-label={ariaLabel}
      aria-current={active === id ? 'page' : undefined}
      data-tour={href === '#/' ? 'feed' : undefined}
    >
      <Icon size={18} aria-hidden="true" />
      {badge > 0 && <span className={`${styles.badge} ${BADGE_TONES[id] ?? ''}`}>{badge > 99 ? '99+' : badge}</span>}
      {reaction && (
        <span className={`${styles.badge} ${styles.reaction}`} aria-hidden="true">
          {reaction}
        </span>
      )}
    </a>
  )
}

// Phones: a floating pill with the sections (Partages too in a household that shares), and the search beside it.
const MobileNav = ({ active }: { active: Active }) => {
  const { t } = useTranslation()
  const counts = useNavCounts()
  const links = useMainLinks()

  return (
    <>
      <div className={styles.fade} aria-hidden="true" />
      <div className={styles.bar}>
        <nav className={`${styles.pill} ${styles.glass}`} aria-label={t('nav.label')}>
          {[...links, SETTINGS_LINK].map(link => (
            <NavItem key={link.id} link={link} active={active} counts={counts} />
          ))}
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
