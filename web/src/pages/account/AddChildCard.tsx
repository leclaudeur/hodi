import { UserPlus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { RowButton } from '../../views/settings/SettingRow.tsx'
import settingsStyles from '../../views/settings/Settings.module.css'
import styles from './AddChildCard.module.css'

// Under the children, as Mes sources' first card: a child's row still to fill, dashed, with its button. With no
// child yet, it is the whole list.
const AddChildCard = ({ onAdd }: { onAdd: () => void }) => {
  const { t } = useTranslation()
  return (
    <div className={`${settingsStyles.row} ${styles.card}`}>
      <span className={styles.avatar} aria-hidden="true">
        <UserPlus size={20} />
      </span>
      <span className={settingsStyles.rowText}>
        <span className={settingsStyles.rowLabel}>{t('children.create.title')}</span>
        <span className={settingsStyles.rowHint}>{t('children.addCard')}</span>
      </span>
      <RowButton
        label={t('children.addButton')}
        ariaLabel={t('children.create.title')}
        look="primary"
        icon={UserPlus}
        onClick={onAdd}
      />
    </div>
  )
}

export default AddChildCard
