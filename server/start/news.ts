import type { Config } from '../config.ts'
import type { HouseholdStore } from '../db/household-store.ts'
import type { NewsStore } from '../db/news-store.ts'
import type { ProfileStore } from '../db/profile-store.ts'
import { type SourceStore, createPauseCheck } from '../db/source-store.ts'
import type { UserStore } from '../db/user-store.ts'
import type { ServerSettingsStore } from '../db/server-settings-store.ts'
import { inHousehold } from '../db/household-scope.ts'
import { pluginFeedReader } from '../plugins/feeds.ts'
import type { PluginRegistry } from '../plugins/registry.ts'
import { type Catalog, allSources, type loadCatalog } from '../news/catalog.ts'
import { NewsService } from '../news/news-service.ts'
import { createExtractPool } from '../news/extract-pool.ts'
import { aiProvider } from '../news/ai-providers.ts'
import { SourceIcons } from '../news/source-icons.ts'
import { isAddressName, nameFromSite } from '../news/source-name.ts'
import { isLanguage } from '../../shared/i18n.ts'
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
  const { config, outside, catalog, file, sources, household, profiles, usersOf, serverSettings, store } = wiring
  // The time zone and AI tools of the household being served (household-scope.ts).
  const householdTimeZone = () => household.get().timeZone ?? config.timeZone
  const householdAi = () => {
    const current = household.get()
    const provider = current.ai ? aiProvider(current.ai.provider) : null
    return current.ai && provider
      ? provider.tools({
          key: current.ai.key,
          model: current.ai.model,
          region: { timeZone: householdTimeZone(), country: current.country }
        })
      : null
  }
  const news = new NewsService(catalog, {
    fetchText: outside.fetchText,
    extractPage: createExtractPool().extract,
    // A plugin's feed, once the plugins are loaded.
    readPluginFeed: pluginFeedReader(wiring.plugins),
    // Each household's own sources; the first one's is the catalogue just loaded.
    catalogOf: () => sources.catalog(file),
    households: () => household.ids(),
    // Each household's own AI key and time zone, read the first time a household is served.
    aiOf: householdAi,
    timeZoneOf: householdTimeZone,
    fetchVideoDuration: outside.fetchVideoDuration,
    isPaused: createPauseCheck({ hiddenByProfile: hiddenByProfileOf(wiring), now: Date.now }),
    profiles: () => profiles.list().map(profile => ({ id: profile.id, admin: profile.role === 'admin' })),
    // The AI writes in the profile's language, else the household's.
    languageOf: profileId => {
      const own = usersOf(profileId).preferences()?.language
      return isLanguage(own) ? own : household.get().language
    },
    householdLanguage: () => household.get().language,
    windows: () => serverSettings.content(),
    store
  })
  // The household's time zone and AI (none until a key is given), again whenever the admin changes them.
  const applyHousehold = () => {
    news.setTimeZone(householdTimeZone())
    news.setAi(householdAi())
  }
  return { news, applyHousehold }
}

// Source avatars. A site added from a link whose feed gave no name ("voici.fr") takes the one its home page gives.
export const createIcons = ({
  catalog,
  outside,
  store,
  sources
}: Pick<NewsWiring, 'catalog' | 'outside' | 'store' | 'sources'>) =>
  new SourceIcons(catalog, {
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
