import { useTranslation } from 'react-i18next'
import { ShortcutKeys } from '../../../app/ShortcutsHelp.tsx'
import { SHORTCUTS, SHORTCUT_GROUPS } from '../../../lib/keyboard-shortcuts.ts'
import SectionPage from '../SectionPage.tsx'
import styles from '../Settings.module.css'
import shortcutStyles from './ShortcutsSection.module.css'

// The keyboard shortcuts, also shown anywhere with "?".
const ShortcutsSection = ({ layout }: { layout: 'desktop' | 'phone' }) => {
  const { t } = useTranslation()
  return (
    <SectionPage title={t('shortcuts.title')} intro={t('shortcuts.intro')} layout={layout}>
      {SHORTCUT_GROUPS.map(group => (
        <section key={group} className={shortcutStyles.group} aria-label={t(`shortcuts.groups.${group}`)}>
          <h2 className={styles.label}>{t(`shortcuts.groups.${group}`)}</h2>
          <dl className={styles.card}>
            {SHORTCUTS.filter(shortcut => shortcut.group === group).map(({ keys, id }) => (
              <div key={id} className={styles.row}>
                {/* The keys come first in the markup, and show on the right. */}
                <dt className={shortcutStyles.keys}>
                  <ShortcutKeys keys={keys} />
                </dt>
                <dd className={`${styles.rowLabel} ${shortcutStyles.label}`}>{t(`shortcuts.${id}`)}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </SectionPage>
  )
}

export default ShortcutsSection
