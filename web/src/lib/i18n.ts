import i18next from 'i18next'
import { initReactI18next, useTranslation } from 'react-i18next'
import fr from '../../../shared/locales/fr.json' with { type: 'json' }
import { I18N_BASE_OPTIONS, type Language, isLanguage } from '../../../shared/i18n.ts'

export { LANGUAGES, type Language, isLanguage } from '../../../shared/i18n.ts'

// The language the interface shows: the one picked in the first-run screens, else the profile's, else the
// household's, else the browser's (before setup, or before the server answered). Components read the texts with
// react-i18next's useTranslation(); code outside React with t() below.

// Each language under its own name, as a picker shows it.
export const LANGUAGE_NAMES: Record<Language, string> = { fr: 'Français', en: 'English' }

// The household's, kept on this device so the sign-in screen opens in it before the server answers.
const STORAGE_KEY = 'hodi:language'

const browserLanguage = (): Language => {
  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = tag.slice(0, 2).toLowerCase()
    if (isLanguage(base)) return base
  }
  return 'fr'
}

const stored = () => {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return isLanguage(value) ? value : null
  } catch {
    return null
  }
}

let household: Language | null = stored()
let profile: Language | null = null
let chosen: Language | null = null
const resolve = () => chosen ?? profile ?? household ?? browserLanguage()

// French, the reference and the fallback, is in the app's code: init is synchronous. Another language comes in its
// own file the first time it is shown (about 17 KB each start would download for nothing otherwise).
const LOADERS: Record<Exclude<Language, 'fr'>, () => Promise<{ default: object }>> = {
  en: () => import('../../../shared/locales/en.json')
}

const loading = new Map<Language, Promise<void>>()

const load = (language: Language): Promise<void> => {
  if (language === 'fr' || i18next.hasResourceBundle(language, 'translation')) return Promise.resolve()
  let pending = loading.get(language)
  if (!pending) {
    pending = LOADERS[language]()
      .then(texts => {
        i18next.addResourceBundle(language, 'translation', texts.default)
      })
      .finally(() => loading.delete(language))
    loading.set(language, pending)
  }
  return pending
}

void i18next.use(initReactI18next).init({
  ...I18N_BASE_OPTIONS,
  resources: { fr: { translation: fr } },
  partialBundledLanguages: true,
  lng: 'fr',
  initAsync: false
})
document.documentElement.lang = i18next.language
i18next.on('languageChanged', language => {
  document.documentElement.lang = language
})

// Shows the language now wanted once its texts are here; until then, the one shown stays (never keys, never a mix).
const update = (): Promise<void> => {
  const next = resolve()
  if (next === i18next.language) return Promise.resolve()
  return load(next).then(
    async () => {
      if (resolve() === next) await i18next.changeLanguage(next)
    },
    // Offline before the file was ever kept: French, the fallback, until the next change.
    () => {}
  )
}

// The app renders once the device's language is shown (at once in French).
export const languageReady = update()

export const setHouseholdLanguage = (language: Language) => {
  household = language
  try {
    localStorage.setItem(STORAGE_KEY, language)
  } catch {
    // Private browsing: the browser's language until the server answers next time.
  }
  void update()
}

// The household's language, which a profile may read in another one.
export const getHouseholdLanguage = (): Language => household ?? resolve()

// null: the household's.
export const setProfileLanguage = (language: Language | null) => {
  profile = language
  void update()
}

// The first-run screens' picker; null once the household exists.
export const setChosenLanguage = (language: Language | null) => {
  chosen = language
  void update()
}

export const getLanguage = (): Language => (isLanguage(i18next.language) ? i18next.language : 'fr')

// In a component: the language shown, and the component shows again when it changes.
export const useLanguage = (): Language => {
  const { i18n } = useTranslation()
  return isLanguage(i18n.language) ? i18n.language : 'fr'
}

// Outside React (toasts, formatters): the language of now.
export const t = i18next.t.bind(i18next)
