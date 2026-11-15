import i18next from 'i18next'
import { pluginNamespace } from '../plugins/registry.ts'

// A plugin refused a sign-in (its checkSignIn): the plugin, and a key of its locales or null.
export interface SignInRefusal {
  plugin: string
  message: string | null
}

export const refusalOf = (body: unknown): SignInRefusal | null => {
  if (typeof body !== 'object' || body === null) return null
  const { error, plugin, message } = body as Record<string, unknown>
  if (error !== 'sign_in_refused') return null
  return { plugin: typeof plugin === 'string' ? plugin : '', message: typeof message === 'string' ? message : null }
}

// The plugin's message when its locales are loaded and have the key, Hodi's neutral one otherwise. Always text:
// React writes it as such, never as markup.
export const refusalText = (refusal: SignInRefusal) => {
  const ns = pluginNamespace(refusal.plugin)
  return refusal.message && refusal.plugin && i18next.exists(refusal.message, { ns } as never)
    ? String(i18next.t(refusal.message as never, { ns } as never))
    : String(i18next.t('login.refused'))
}
