import type { Config } from '../config.ts'
import type { accountSession } from '../http/account-session.ts'
import type { HouseholdRoutesOptions } from '../http/setup-routes.ts'
import type { Language } from '../news/catalog.ts'
import type { Options } from './wiring.ts'

// « Plugins trouvés »: the plugins put in data/plugins before the first start, and their switch.
const setupPluginsOf = ({ plugins }: Options) =>
  plugins
    ? {
        list: () =>
          plugins.list().map(plugin => ({
            id: plugin.id,
            name: plugin.manifest?.name ?? plugin.id,
            description: plugin.manifest?.description ?? null,
            translations: plugin.translations,
            enabled: plugins.enabled(plugin.id),
            signed: plugin.signed,
            error: plugin.error ?? (plugin.manifest ? null : 'no_manifest')
          })),
        setEnabled: (id: string, enabled: boolean) => plugins.store.setEnabled(id, enabled)
      }
    : undefined

// The catalogue waited for the household's language: its base sources are listed from now on.
const onSetUpOf =
  ({ sources, news, now }: Options) =>
  (language: Language) => {
    if (!sources) return
    const filled = sources.store.load(sources.file, now(), language)
    for (const topic of filled.topics) {
      const listed = news.catalog.topics.find(candidate => candidate.id === topic.id)?.sources ?? []
      for (const source of topic.sources) {
        if (!listed.some(candidate => candidate.id === source.id)) news.addSource(source, 'topic', [topic.id])
      }
    }
  }

// The setup and Réglages › Foyer routes' options; null in tests without profiles.
export const householdOptionsOf = (
  config: Config,
  options: Options,
  { accountOf, cookieFor }: ReturnType<typeof accountSession>
): HouseholdRoutesOptions | null => {
  const { profiles, household, aiProviders, now, setupCode, throttle, accounts } = options
  const { passwordResets, serverMail, serverSettings, onHouseholdChange } = options
  if (!profiles) return null
  return {
    household,
    profiles,
    providers: aiProviders,
    now,
    secret: config.sessionSecret,
    defaultTimeZone: config.timeZone,
    setupCode,
    throttle,
    accounts,
    accountOf,
    cookieFor,
    onChange: onHouseholdChange,
    // « Mot de passe oublié » shows on Connexion once Hodi can send its link.
    canResetByMail: () => (passwordResets && serverMail?.store.canSendLinks()) ?? false,
    householdLater: serverSettings
      ? { get: () => serverSettings.householdLater(), set: later => serverSettings.setHouseholdLater(later) }
      : undefined,
    setupPlugins: setupPluginsOf(options),
    onSetUp: onSetUpOf(options)
  }
}
