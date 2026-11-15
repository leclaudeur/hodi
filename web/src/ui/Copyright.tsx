import { useTranslation } from 'react-i18next'
import styles from './Copyright.module.css'

interface CopyrightProps {
  className?: string
}

// The line at the bottom of the screens outside the app (login, "Qui lit ?", "À demain", the setup screens): the
// copyright and the licence, everywhere the same.
const Copyright = ({ className = '' }: CopyrightProps) => {
  const { t } = useTranslation()
  return (
    <p className={`${styles.copyright} ${className}`}>
      © {new Date().getFullYear()} Hodi · {t('common.licence')}
    </p>
  )
}

export default Copyright
