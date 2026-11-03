import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { FRONT_PAGE_HREF, searchHref } from '../lib/use-hash-route.ts'
import { useIsDesktop } from '../lib/use-media.ts'
import Button from '../ui/Button.tsx'
import PhoneHeader from '../ui/PhoneHeader.tsx'
import styles from './NotFound.module.css'

interface NotFoundProps {
  title?: string
  children?: string
}

// A link to nothing (an unknown topic, an article gone from the feeds), from the charter's "404" boards.
const NotFound = ({ title, children }: NotFoundProps) => {
  const { t } = useTranslation()
  const isDesktop = useIsDesktop()

  return (
    <div className={styles.page}>
      {!isDesktop && <PhoneHeader logo={FRONT_PAGE_HREF} className={styles.header} />}
      <div className={styles.content} role="alert">
        <p className={styles.code} aria-hidden="true">
          404
        </p>
        <h1 className={`${styles.title} screen-title`}>{title ?? t('notFound.title')}</h1>
        <p className={styles.text}>{children ?? t('notFound.text')}</p>
        <div className={styles.actions}>
          <Button look="primary" href={FRONT_PAGE_HREF}>
            {t('nav.backToFeed')}
          </Button>
          <Button icon={Search} href={searchHref()}>
            {t('nav.search')}
          </Button>
        </div>
        <p className={styles.path}>
          {t('notFound.error')} · {window.location.hash.replace(/^#/, '') || '/'}
        </p>
      </div>
    </div>
  )
}

export default NotFound
