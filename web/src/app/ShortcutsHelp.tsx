import { useTranslation } from 'react-i18next'
import { SHORTCUTS, SHORTCUT_GROUPS } from '../lib/keyboard-shortcuts.ts'
import Dialog from '../ui/Dialog.tsx'
import SparkleIcon from '../ui/SparkleIcon.tsx'
import styles from './ShortcutsHelp.module.css'
import RichText from '../ui/RichText.tsx'

export const ShortcutKeys = ({ keys }: { keys: readonly string[] }) => {
  const { t } = useTranslation()
  return (
    <span className={styles.keys}>
      {keys.map(key => (
        <kbd key={key}>{key === 'escape' ? t('shortcuts.escape') : key}</kbd>
      ))}
    </span>
  )
}

interface ShortcutsHelpProps {
  onClose: () => void
}

// The keyboard shortcuts above the page, from the charter's "Raccourcis" board; Escape or a click outside closes it.
const ShortcutsHelp = ({ onClose }: ShortcutsHelpProps) => {
  const { t } = useTranslation()
  return (
    <Dialog
      open
      onClose={onClose}
      size="wide"
      title={t('shortcuts.title')}
      intro={<RichText i18nKey="dialogIntro.shortcuts" />}
    >
      <div className={styles.groups}>
        {SHORTCUT_GROUPS.map(group => (
          <section key={group} aria-label={t(`shortcuts.groups.${group}`)}>
            <h3 className={styles.group}>{t(`shortcuts.groups.${group}`)}</h3>
            <dl className={styles.list}>
              {SHORTCUTS.filter(shortcut => shortcut.group === group).map(({ keys, id }) => (
                <div key={id} className={styles.row}>
                  <dt>
                    <ShortcutKeys keys={keys} />
                  </dt>
                  <dd>{t(`shortcuts.${id}`)}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <p className={styles.note}>
        <SparkleIcon size={14} />
        {t('shortcuts.aiNote')}
      </p>
    </Dialog>
  )
}

export default ShortcutsHelp
