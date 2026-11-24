import type { Config } from '../config.ts'
import type { InstallStore } from '../db/install-store.ts'
import type { NewsStore } from '../db/news-store.ts'
import type { ProfileStore } from '../db/profile-store.ts'
import { type SourceStore, createPauseCheck } from '../db/source-store.ts'
import type { UserAccountStore } from '../db/user-account-store.ts'
import type { UserStore } from '../db/user-store.ts'
import type { ServerSettingsStore } from '../db/server-settings-store.ts'
import { pluginFeedReader } from '../plugins/feeds.ts'
import type { PluginRegistry } from '../plugins/registry.ts'
import type { Catalog, loadCatalog } from '../news/catalog.ts'
import { NewsService } from '../news/news-service.ts'
import { createExtractPool } from '../news/extract-pool.ts'
import { SourceIcons } from '../news/source-icons.ts'
import { isAddressName, nameFromSite } from '../news/source-name.ts'
import { isLanguage } from '../../shared/i18n.ts'
import type { AccountAiStore } from '../db/account-ai-store.ts'
import { accountAiTools } from './account-ai.ts'
import type { Outside } from './outside.ts'

// The news service, wired to the profiles and settings in the database (start.ts).

interface NewsWiring {
  config: Config
  outside: Outside
  catalog: Catalog
  file: ReturnType<typeof loadCatalog>
  sources: SourceStore
  install: InstallStore
  profiles: ProfileStore
  usersOf: (profileId: number) => UserStore
  accounts: UserAccountStore
  accountAi: AccountAiStore
  serverSettings: ServerSettingsStore
  store: NewsStore
  plugins: () => PluginRegistry | null
}

// A source every profile turned off is not fetched.
const hiddenByProfileOf =
  ({ profiles, usersOf }: NewsWiring) =>
  () =>
    profiles.everyone().map(profile => usersOf(profile.id).hiddenSources())

export const createNews = (wiring: NewsWiring) => {
  const { config, outside, catalog, install, usersOf, serverSettings, store } = wiring
  // The time zone chosen at setup, else the install's.
  const householdTimeZone = () => install.get().timeZone ?? config.timeZone
  const news = new NewsService(catalog, {
    fetchText: outside.fetchText,
    extractPage: createExtractPool().extract,
    // A plugin's feed, once the plugins are loaded.
    readPluginFeed: pluginFeedReader(wiring.plugins),
    // Each reader's AI is its account's own key: a profile with no account has none.
    aiOf: accountAiTools(wiring),
    timeZoneOf: householdTimeZone,
    // A reader's Résumé du jour follows its account's days.
    readerTimeZoneOf: profileId => wiring.accounts.timeZoneOfProfile(profileId),
    fetchVideoDuration: outside.fetchVideoDuration,
    isPaused: createPauseCheck({ hiddenByProfile: hiddenByProfileOf(wiring), now: Date.now }),
    // The AI writes in the profile's language, else the server's.
    languageOf: profileId => {
      const own = usersOf(profileId).preferences()?.language
      return isLanguage(own) ? own : install.get().language
    },
    householdLanguage: () => install.get().language,
    windows: () => serverSettings.content(),
    store
  })
  // The server's time zone, again whenever it changes.
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
