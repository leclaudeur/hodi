import { Plus } from 'lucide-react'
import Button from './Button.tsx'
import styles from './SourceCard.module.css'

interface AddSourceCardProps {
  title: string
  text: string
  label: string
  // The guided tour's mark: add-source, or ask-source for a teen.
  tour: string
  onAdd: () => void
}

// The first card of Mes sources: a source's card still to fill, dashed, with its button.
const AddSourceCard = ({ title, text, label, tour, onAdd }: AddSourceCardProps) => (
  <li className={`${styles.card} ${styles.empty}`}>
    <span className={styles.emptyAvatar} aria-hidden="true" />
    <h3 className={styles.name}>{title}</h3>
    <span className={styles.emptyLine}>{text}</span>
    <span className={styles.footer}>
      <Button compact look="primary" icon={Plus} onClick={onAdd} data-tour={tour}>
        {label}
      </Button>
    </span>
  </li>
)

export default AddSourceCard
