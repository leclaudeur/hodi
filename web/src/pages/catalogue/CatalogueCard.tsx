import { ExternalLink, Minus, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { type CatalogueEntry, readersCount } from '../../lib/catalogue.ts'
import { getLanguage } from '../../lib/i18n.ts'
import RoundButton from '../../ui/RoundButton.tsx'
import SourceAvatar from '../../ui/SourceAvatar.tsx'
import { hostOf } from '../../views/settings/sections/sources-model.ts'
import styles from './CatalogueCard.module.css'

interface CatalogueCardProps {
  entry: CatalogueEntry
  busy: boolean
  onAdd: () => void
  onRemove: () => void
}

// A source of the catalogue: its logo, its name, what it says it is, its readers, then + (or − once it is in
// « Mes sources ») and its site.
const CatalogueCard = ({ entry, busy, onAdd, onRemove }: CatalogueCardProps) => {
  const { t } = useTranslation()
  const meta = [
    hostOf(entry.site),
    entry.readers
      ? t('sources.readers', { count: entry.readers, formatted: readersCount(entry.readers, getLanguage()) })
      : null,
    entry.mine ? t('catalogue.mine') : null
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <li className={`${styles.card} ${entry.mine ? styles.mine : ''}`}>
      <SourceAvatar sourceId={entry.id} sourceName={entry.name} size={44} />
      <div className={styles.text}>
        <h3 className={styles.name}>{entry.name}</h3>
        {entry.description && <p className={styles.description}>{entry.description}</p>}
        <span className={styles.meta}>{meta}</span>
      </div>
      <div className={styles.actions}>
        {entry.mine ? (
          <RoundButton
            icon={Minus}
            size={38}
            label={t('catalogue.remove', { name: entry.name })}
            title={t('catalogue.removeShort')}
            onClick={onRemove}
          />
        ) : (
          <RoundButton
            icon={Plus}
            size={38}
            variant="primary"
            busy={busy}
            label={t('catalogue.add', { name: entry.name })}
            title={t('catalogue.addShort')}
            onClick={onAdd}
          />
        )}
        <RoundButton
          icon={ExternalLink}
          size={38}
          label={t('addSource.seeSite', { name: entry.name })}
          title={t('catalogue.openSite')}
          href={entry.site}
          external
        />
      </div>
    </li>
  )
}

export default CatalogueCard
