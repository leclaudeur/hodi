import { ChevronRight } from 'lucide-react'
import styles from './MoreRow.module.css'

// The last row of a list that shows its first few: « Voir les 4 autres », inside the list's card, opens the rest.
const MoreRow = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button type="button" className={styles.row} onClick={onClick}>
    <span>{label}</span>
    <ChevronRight size={16} aria-hidden="true" />
  </button>
)

export default MoreRow
