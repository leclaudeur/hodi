import i18next from 'i18next'
import type { Language } from '../shared/i18n.ts'
import { I18N_OPTIONS } from '../shared/locales.ts'

// The few texts the server writes itself (push notifications), from the same locale files as the app, in the
// language of the profile they go to.
const instance = i18next.createInstance()
void instance.init({ ...I18N_OPTIONS, lng: 'fr', initAsync: false })

export const textsIn = (language: Language) => instance.getFixedT(language)
