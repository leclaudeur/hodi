import { ArrowLeft, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import styles from '../pages/ProfilePicker.module.css'
import Button from '../ui/Button.tsx'
import Copyright from '../ui/Copyright.tsx'
import PhoneHeader from '../ui/PhoneHeader.tsx'
import StatusLine from '../ui/StatusLine.tsx'

export interface Tile {
  key: string
  label: string
  // Drawn in the round: an icon (a house), or else the label's first letter.
  icon?: LucideIcon
  onClick: () => void
}

interface TilesPageProps {
  title: string
  // One line under the title, centred.
  intro?: ReactNode
  tiles: Tile[]
  // The tile being opened pulses, and the others wait.
  opening?: string | null
  error?: string | null
  // « Retour » under the tiles.
  onBack?: () => void
  // More buttons beside « Retour », at the same height.
  actions?: ReactNode
}

// A choice among a few, drawn as « Qui lit ? » draws the profiles: big round tiles with their names, then the
// buttons under them (« Quel foyer ? »).
const TilesPage = ({ title, intro, tiles, opening = null, error, onBack, actions }: TilesPageProps) => {
  const { t } = useTranslation()
  return (
    <main className={styles.page}>
      <PhoneHeader logo className={styles.header} />
      <div className={styles.content}>
        <h1 className={styles.title}>{title}</h1>
        {intro && <p className={styles.intro}>{intro}</p>}
        <ul className={`${styles.grid} ${styles.wideGrid}`} aria-busy={opening !== null}>
          {tiles.map(({ key, label, icon: Icon, onClick }) => (
            <li key={key}>
              <button
                type="button"
                className={`${styles.tile} ${styles.wideTile}`}
                onClick={onClick}
                disabled={opening !== null}
              >
                <span className={`${styles.avatar} ${opening === key ? styles.opening : ''}`}>
                  <span className={styles.round} aria-hidden="true">
                    {Icon ? <Icon size={36} /> : label.trim().charAt(0).toUpperCase()}
                  </span>
                </span>
                <span className={`${styles.name} ${styles.fullName}`}>{label}</span>
              </button>
            </li>
          ))}
        </ul>
        {error && (
          <StatusLine tone="error" className={styles.error}>
            {error}
          </StatusLine>
        )}
        {(onBack || actions) && (
          <div className={styles.actions}>
            {onBack && (
              <Button icon={ArrowLeft} onClick={onBack}>
                {t('common.back')}
              </Button>
            )}
            {actions}
          </div>
        )}
      </div>
      <Copyright />
    </main>
  )
}

export default TilesPage
