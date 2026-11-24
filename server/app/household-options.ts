import type { Config } from '../config.ts'
import type { accountSession } from '../http/account-session.ts'
import type { HouseholdRoutesOptions } from '../http/setup-routes.ts'
import type { Language } from '../news/catalog.ts'
import { giveBaseSources } from './profile-hooks.ts'
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
export const onSetUpOf = (options: Options) => (language: Language) => {
  const { sources, news, profiles, now } = options
  if (!sources) return
  const filled = sources.store.load(sources.file, now(), language)
  for (const topic of filled.topics) {
    const listed = news.catalog.topics.find(candidate => candidate.id === topic.id)?.sources ?? []
    for (const source of topic.sources) {
      if (!listed.some(candidate => candidate.id === source.id)) news.addSource(source, 'topic', [topic.id])
    }
  }
  profiles
    ?.everyone()
    .filter(profile => profile.kind === 'adult')
    .forEach(profile => giveBaseSources(options, profile.id))
}

// The setup and Réglages › Foyer routes' options; null in tests without profiles.
export const householdOptionsOf = (
  config: Config,
  options: Options,
  { accountOf, cookieFor }: ReturnType<typeof accountSession>
): HouseholdRoutesOptions | null => {
  const { profiles, install, aiProviders, now, setupCode, throttle, accounts, accountAi } = options
  const { passwordResets, serverMail, serverSettings, onHouseholdChange } = options
  if (!profiles) return null
  return {
    install,
    profiles,
    providers: aiProviders,
    now,
    secret: config.sessionSecret,
    defaultTimeZone: config.timeZone,
    setupCode,
    throttle,
    accounts,
    accountAi,
    accountOf,
    cookieFor,
    onChange: onHouseholdChange,
    // « Mot de passe oublié » shows on Connexion once Hodi can send its link.
    canResetByMail: () => (passwordResets && serverMail?.store.canSendLinks()) ?? false,
    publicHome: serverSettings ? () => serverSettings.publicHome() : undefined,
    setupPlugins: setupPluginsOf(options),
    onSetUp: onSetUpOf(options)
  }
}
