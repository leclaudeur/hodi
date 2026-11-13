import type { LoginThrottle } from './auth/login-throttle.ts'
import type { AccountDataStore } from './db/account-data.ts'
import type { Database } from './db/database.ts'
import type { GameStore } from './db/game-store.ts'
import type { HouseholdStore } from './db/household-store.ts'
import type { MailSettingsStore } from './db/mail-settings-store.ts'
import type { PluginBackup } from './db/maintenance.ts'
import type { PasswordResetStore } from './db/password-reset-store.ts'
import type { ProfileDeviceStore } from './db/profile-device-store.ts'
import type { ProfileStore } from './db/profile-store.ts'
import type { ServerPeopleStore } from './db/server-people-store.ts'
import type { ServerSettingsStore } from './db/server-settings-store.ts'
import type { ServerStatsStore } from './db/server-stats-store.ts'
import type { SignInCodeStore } from './db/sign-in-code-store.ts'
import type { SourceStore } from './db/source-store.ts'
import type { TwoFactorStore } from './db/two-factor-store.ts'
import type { UserAccountStore } from './db/user-account-store.ts'
import type { UserDeviceStore } from './db/user-device-store.ts'
import type { UserStore } from './db/user-store.ts'
import type { YouthStore } from './db/youth-store.ts'
import type { ArticleImages } from './http/article-routes.ts'
import type { SendMail } from './mail/mailer.ts'
import type { AiProvider } from './news/ai-providers.ts'
import type { Catalog } from './news/catalog.ts'
import type { FollowedAlerts } from './news/followed-alerts.ts'
import type { NewsService } from './news/news-service.ts'
import type { FindResult } from './news/source-finder.ts'
import type { SourceIcons } from './news/source-icons.ts'
import type { PluginAi } from './plugins/ai.ts'
import type { HouseholdHooks } from './plugins/households.ts'
import type { PluginInstaller } from './plugins/installer.ts'
import type { PluginCatalog } from './plugins/catalog.ts'
import type { PluginRegistry } from './plugins/registry.ts'

// Everything createApp needs; most stores are optional so a test builds only what it checks.
export interface AppOptions {
  news: NewsService
  // Notifications for followed subjects, when VAPID keys are set.
  alerts?: FollowedAlerts
  // The household's profiles, and each one's state shared by its devices; absent in tests that do not need them.
  profiles?: ProfileStore
  users?: (profileId: number) => UserStore
  // Source avatars; without them the app shows the sources' initials.
  icons?: SourceIcons
  // Article pictures made smaller on the server; without them the app shows the sites' originals.
  images?: ArticleImages
  // What the database takes on disk, and emptying its reader texts, for the settings;
  // absent in tests that do not need it.
  storage?: { usage: () => StorageUsage; clearTexts: () => void }
  // "Ajouter une source": the catalogue in the database and the feed finder; absent in tests that do not need them.
  // file: sources.yml's catalogue, whose sources not yet added are offered ("Sources proposées").
  sources?: { store: SourceStore; find: (link: string) => Promise<FindResult>; file: Catalog }
  // The household game's points (gamification.yml); absent in tests that do not need it.
  game?: GameStore
  // The young profiles' rules and time; absent in tests that do not need them.
  youth?: YouthStore
  // The installed plugins (data/plugins/); absent in tests that do not need them.
  plugins?: PluginRegistry
  // What the households a plugin makes need from the app; filled in here.
  householdHooks?: HouseholdHooks
  // Installs and removes them, then restarts Hodi; absent in tests that do not install anything.
  pluginInstaller?: { installer: PluginInstaller; restart: () => void; catalog?: PluginCatalog }
  // The household's AI for the plugins' AiButtons (plugins/ai.ts), shared with the registry's ctx.ai.
  pluginAi?: PluginAi
  // The household's name, region and AI, from the first-run screens.
  household: HouseholdStore
  // The people's own accounts; absent in tests of an install from before them, which signs in with the household's
  // password.
  accounts?: UserAccountStore
  // Serveur › Vue d'ensemble: the server's totals and who is online.
  serverStats?: ServerStatsStore
  // Serveur › Foyers and Comptes.
  serverPeople?: ServerPeopleStore
  // Serveur › Contenu.
  serverSettings?: ServerSettingsStore
  // Serveur › Sauvegardes: the database to copy and where its copies are, with the plugins' data.
  // restore: where « Restaurer » sets a copy aside, and the restart that puts it back.
  serverBackups?: {
    db: Database
    dir: string
    plugins?: PluginBackup
    restore?: { pending: string; restart: () => void }
  }
  // Serveur › E-mail: the mail server's settings, and what sends through it (a fake in tests).
  serverMail?: { store: MailSettingsStore; send: SendMail }
  // « Mot de passe oublié »: the links sent by e-mail, once Serveur › E-mail is set.
  passwordResets?: PasswordResetStore
  // Réglages > Compte et données > Appareils: each device signed in with an account; with accounts.
  devices?: UserDeviceStore
  // "Télécharger une copie" and "Supprimer ton compte"; with accounts.
  accountData?: AccountDataStore
  // "J'ai un code": the codes adults give to let a person make their account; with accounts.
  codes?: SignInCodeStore
  // « Validation en deux étapes »: absent in tests that do not need it.
  twoFactor?: TwoFactorStore
  // A young profile's own devices, linked with a code; with accounts.
  profileDevices?: ProfileDeviceStore
  // Asked in the first-run screens of a device that is not on the server's own network.
  setupCode?: string
  // The AIs a household can pick (AI_PROVIDERS); fakes in tests.
  aiProviders?: AiProvider[]
  // The household's region or AI changed.
  onHouseholdChange?: () => void
  now?: () => number
  throttle?: LoginThrottle
  // Wrong PINs, for every profile together.
  pinThrottle?: LoginThrottle
}

export interface StorageUsage {
  databaseBytes: number
  backupBytes: number
  backups: number
  articles: number
  texts: number
}
