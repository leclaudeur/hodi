import 'i18next'
import type fr from './locales/fr.json'

// t('setup.start.title') is checked against fr.json: a key that doesn't exist is a type error.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: { translation: typeof fr }
  }
}
