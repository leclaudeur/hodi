import type { Config } from '../config.ts'
import type { HouseholdStore } from '../db/household-store.ts'
import type { NewsStore } from '../db/news-store.ts'
import type { ProfileStore } from '../db/profile-store.ts'
import { type SourceStore, createPauseCheck } from '../db/source-store.ts'
import type { UserAccountStore } from '../db/user-account-store.ts'
import type { UserStore } from '../db/user-store.ts'
import type { ServerSettingsStore } from '../db/server-settings-store.ts'
import { inHousehold } from '../db/household-scope.ts'
import { pluginFeedReader } from '../plugins/feeds.ts'
import type { PluginRegistry } from '../plugins/registry.ts'
import { type Catalog, allSources, type loadCatalog } from '../news/catalog.ts'
import { NewsService } from '../news/news-service.ts'
import { createExtractPool } from '../news/extract-pool.ts'
import { SourceIcons } from '../news/source-icons.ts'
import { isAddressName, nameFromSite } from '../news/source-name.ts'
import { isLanguage } from '../../shared/i18n.ts'
import type { AccountAiStore } from '../db/account-ai-store.ts'
import { accountAiTools } from './account-ai.ts'
import type { Outside } from './outside.ts'

// The news service, wired to the households, profiles and settings in the database (start.ts).

interface NewsWiring {
  config: Config
  outside: Outside
  catalog: Catalog
  file: ReturnType<typeof loadCatalog>
  sources: SourceStore
  household: HouseholdStore
  profiles: ProfileStore
  usersOf: (profileId: number) => UserStore
  accounts: UserAccountStore
  accountAi: AccountAiStore
  serverSettings: ServerSettingsStore
  store: NewsStore
  plugins: () => PluginRegistry | null
}

// A source every profile turned off is not fetched. A profile does not read what its household does not follow.
const hiddenByProfileOf =
  ({ file, sources, household, profiles, usersOf }: NewsWiring) =>
  () => {
    const followed = new Map(
      household
        .ids()
        .map(id => [id, inHousehold(id, () => new Set(allSources(sources.catalog(file)).map(source => source.id)))])
    )
    const every = [...new Set([...followed.values()].flatMap(ids => [...ids]))]
    return household
      .ids()
      .flatMap(id =>
        inHousehold(id, () =>
          profiles
            .list()
            .map(profile => [
              ...usersOf(profile.id).hiddenSources(),
              ...every.filter(sourceId => !followed.get(id)!.has(sourceId))
            ])
        )
      )
  }

export const createNews = (wiring: NewsWiring) => {
  const { config, outside, catalog, file, sources, household, usersOf, serverSettings, store } = wiring
  // The time zone of the household being served (household-scope.ts).
  const householdTimeZone = () => household.get().timeZone ?? config.timeZone
  const news = new NewsService(catalog, {
    fetchText: outside.fetchText,
    extractPage: createExtractPool().extract,
    // A plugin's feed, once the plugins are loaded.
    readPluginFeed: pluginFeedReader(wiring.plugins),
    // Each household's own sources; the first one's is the catalogue just loaded.
    catalogOf: () => sources.catalog(file),
    households: () => household.ids(),
    // Each reader's AI is its account's own key: a profile with no account has none.
    aiOf: accountAiTools(wiring),
    timeZoneOf: householdTimeZone,
    // A reader's Résumé du jour follows its account's days.
    readerTimeZoneOf: profileId => wiring.accounts.timeZoneOfProfile(profileId),
    fetchVideoDuration: outside.fetchVideoDuration,
    isPaused: createPauseCheck({ hiddenByProfile: hiddenByProfileOf(wiring), now: Date.now }),
    // The AI writes in the profile's language, else the household's.
    languageOf: profileId => {
      const own = usersOf(profileId).preferences()?.language
      return isLanguage(own) ? own : household.get().language
    },
    householdLanguage: () => household.get().language,
    windows: () => serverSettings.content(),
    store
  })
  // The household's time zone, again whenever the admin changes it.
  const applyHousehold = () => {
    news.setTimeZone(householdTimeZone())
  }
  return { news, applyHousehold }
}

// Source avatars. A site added from a link whose feed gave no name ("voici.fr") takes the one its home page gives.
export const createIcons = ({
  file,
  outside,
  store,
  sources
}: Pick<NewsWiring, 'file' | 'outside' | 'store' | 'sources'>) =>
  new SourceIcons(() => sources.catalog(file), {
    fetchText: outside.fetchText,
    fetchBytes: outside.fetchBytes,
    store,
    siteName: {
      wanted: source => /^p\d+-/.test(source.id) && source.kind === 'article' && isAddressName(source.name),
      found: (source, siteName) => {
        const name = nameFromSite(source.name, `https://${source.domains[0]}/`, siteName)
        if (!name) return
        sources.rename(source.id, name)
        source.name = name
      }
    }
  })
