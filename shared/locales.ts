import en from './locales/en.json' with { type: 'json' }
import fr from './locales/fr.json' with { type: 'json' }
import { I18N_BASE_OPTIONS } from './i18n.ts'

// Every language's texts at once, for the server and the tests. The web app does not import this file: it would put
// every language in the code each start downloads.
export const RESOURCES = { fr: { translation: fr }, en: { translation: en } } as const

export const I18N_OPTIONS = { ...I18N_BASE_OPTIONS, resources: RESOURCES } as const
