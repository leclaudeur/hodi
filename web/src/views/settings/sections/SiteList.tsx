import { Check, ExternalLink, Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '../../../ui/Button.tsx'
import RoundButton from '../../../ui/RoundButton.tsx'
import styles from './SiteList.module.css'
import LanguageChip from '../../../ui/LanguageChip.tsx'
import type { Language } from '../../../lib/i18n.ts'

// The site's address as it reads: "numerama.com".
export const siteOf = (link: string) => {
  try {
    return new URL(link).hostname.replace(/^www\./, '')
  } catch {
    return link
  }
}

// Sites to add in one tap: ours in the neutral colours, the AI's in violet.
export const SiteList = ({ tone, children }: { tone: 'neutral' | 'ai'; children: ReactNode }) => (
  <ul className={`${styles.list} ${styles[tone]}`}>{children}</ul>
)

interface SiteRowProps {
  name: string
  link: string
  // The site's language, when it is known.
  lang?: Language
  // What the AI says of it, how it reads, its last article.
  children?: ReactNode
  added: boolean
  adding: boolean
  // Another one is being added: one at a time.
  busy: boolean
  onAdd: () => void
}

// One site: its name and address, a link to look at it, then "Ajouter" until it is in.
export const SiteRow = ({ name, link, lang, children, added, adding, busy, onAdd }: SiteRowProps) => {
  const { t } = useTranslation()
  return (
    <li className={styles.item}>
      <span className={styles.text}>
        <span className={styles.name}>{name}</span>
        {/* Its language right after its address, as a card's meta, rather than among the buttons. */}
        <span className={styles.meta}>
          <span className={styles.site}>{siteOf(link)}</span>
          {lang && <LanguageChip lang={lang} />}
        </span>
        {children}
      </span>
      <span className={styles.actions}>
        <RoundButton icon={ExternalLink} label={t('addSource.seeSite', { name })} size={44} href={link} external />
        {added ? (
          <span className={styles.added}>
            <Check size={14} aria-hidden="true" />
            {t('addSource.added')}
          </span>
        ) : (
          <Button look="primary" icon={Plus} busy={adding} disabled={busy} onClick={onAdd}>
            {t('profiles.add')}
          </Button>
        )}
      </span>
    </li>
  )
}
