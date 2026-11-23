import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import styles from './RadioCards.module.css'

export interface RadioCard {
  id: string
  label: string
  hint: string
  // In the square on the left.
  icon: ReactNode
  // An AI provider: violet, as the AI cards in the reader.
  ai?: boolean
}

interface RadioCardsProps {
  // The group's name, read aloud.
  label: string
  cards: RadioCard[]
  value: string | null
  onChange: (id: string) => void
}

// One choice among a few, each a card with its icon, name and a line on it (the setup's AI, a report's reason).
const RadioCards = ({ label, cards, value, onChange }: RadioCardsProps) => (
  <div className={styles.list} role="radiogroup" aria-label={label}>
    {cards.map(card => (
      <button
        key={card.id}
        type="button"
        role="radio"
        aria-checked={value === card.id}
        className={`${styles.choice} ${card.ai ? styles.ai : ''}`}
        onClick={() => onChange(card.id)}
      >
        <span className={styles.mark} aria-hidden="true">
          {card.icon}
        </span>
        <span className={styles.text}>
          <span className={styles.label}>{card.label}</span>
          <span className={styles.hint}>{card.hint}</span>
        </span>
        {value === card.id && (
          <span className={styles.check} aria-hidden="true">
            <Check size={12} strokeWidth={3} />
          </span>
        )}
      </button>
    ))}
  </div>
)

export default RadioCards
