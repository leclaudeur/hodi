import { LANGUAGES, LANGUAGE_NAMES, setChosenLanguage, useLanguage } from '../lib/i18n.ts'
import styles from './LanguageRound.module.css'

// The signed-out screens' language, as on the public site: a round with the other language's code, which switches
// to it.
const LanguageRound = () => {
  const language = useLanguage()
  const next = LANGUAGES.find(option => option !== language) ?? language
  return (
    <button
      type="button"
      className={styles.round}
      lang={next}
      aria-label={LANGUAGE_NAMES[next]}
      title={LANGUAGE_NAMES[next]}
      onClick={() => setChosenLanguage(next)}
    >
      {next.toUpperCase()}
    </button>
  )
}

export default LanguageRound
