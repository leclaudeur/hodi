import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import Logo from './Logo.tsx'
import styles from './PhoneHeader.module.css'

interface PhoneHeaderProps {
  // On the left: the back button.
  back?: ReactNode
  // The logo, as on the front page: for the screens outside the lists (404, "Qui lit ?"). A link when
  // given its address.
  logo?: boolean | string
  // The page's name in the charter's display font ("Le fil", "Résumé du jour"); or the logo.
  title?: ReactNode
  // Right after the title: its "?".
  help?: ReactNode
  // Beside the title: "6 ARTICLES".
  meta?: ReactNode
  // On the right: the page's round buttons.
  actions?: ReactNode
  // Held at the top of the screen while the page scrolls under it (an article, a video).
  sticky?: boolean
  // The line under it; replaced by the reading progress in an article.
  line?: boolean | ReactNode
  // Over an article's picture: held at the top from the start, so the picture runs up under it.
  overPicture?: boolean
  // With overPicture: no band nor line while the picture is still under it.
  clear?: boolean
  className?: string
}

// The logo, a link when given its address.
const LogoMark = ({ logo }: { logo: boolean | string }) => {
  const { t } = useTranslation()
  if (typeof logo === 'string') {
    return (
      <a className={styles.logo} href={logo} aria-label={t('nav.home')}>
        <Logo />
      </a>
    )
  }
  if (!logo) return null
  return (
    <span className={styles.logo}>
      <Logo />
    </span>
  )
}

// The page's name, with its "?" right after it; without a name, a space that keeps the buttons on the right.
const Title = ({ title, help }: { title: ReactNode; help: ReactNode }) => {
  if (!title) return <span className={styles.space} />
  const heading = <h1 className={`${styles.title} ${typeof title === 'string' ? 'screen-title' : ''}`}>{title}</h1>
  if (!help) return heading
  return (
    <span className={styles.titleGroup}>
      {heading}
      {help}
    </span>
  )
}

// Every header on a phone or an upright tablet: the same band, buttons, margins and line, from the
// pages' headers to the article's and the video's.
const PhoneHeader = ({
  back,
  logo = false,
  title,
  help,
  meta,
  actions,
  sticky = false,
  line = false,
  overPicture = false,
  clear = false,
  className
}: PhoneHeaderProps) => {
  const classes = [
    styles.header,
    (sticky || overPicture) && styles.sticky,
    overPicture && styles.overPicture,
    overPicture && clear && styles.clear,
    className
  ]
  return (
    <header className={classes.filter(Boolean).join(' ')}>
      <div className={styles.row}>
        {back}
        <LogoMark logo={logo} />
        <Title title={title} help={help} />
        {meta && <span className={styles.meta}>{meta}</span>}
        {actions}
      </div>
      {!(overPicture && clear) && line && (line === true ? <div className={styles.line} aria-hidden="true" /> : line)}
    </header>
  )
}

export default PhoneHeader
