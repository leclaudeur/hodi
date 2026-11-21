import path from 'node:path'
import type { Config } from '../config.ts'
import type { Database } from '../db/database.ts'
import type { ForgetLog } from '../db/forget-log.ts'
import { type PluginBackup, startMaintenance } from '../db/maintenance.ts'
import { HouseholdStore } from '../db/household-store.ts'
import { AccountDataStore } from '../db/account-data.ts'
import { SignInCodeStore } from '../db/sign-in-code-store.ts'
import { TwoFactorStore } from '../db/two-factor-store.ts'
import { ProfileDeviceStore } from '../db/profile-device-store.ts'
import { UserDeviceStore } from '../db/user-device-store.ts'
import { HandleStore } from '../db/handle-store.ts'
import { UserAccountStore } from '../db/user-account-store.ts'
import { AccountAiStore } from '../db/account-ai-store.ts'
import { NewsStore } from '../db/news-store.ts'
import { ProfileStore } from '../db/profile-store.ts'
import { SourceStore } from '../db/source-store.ts'
import { UserStore } from '../db/user-store.ts'
import { GameStore } from '../db/game-store.ts'
import { ServerPeopleStore } from '../db/server-people-store.ts'
import { ServerSettingsStore } from '../db/server-settings-store.ts'
import { ServerStatsStore } from '../db/server-stats-store.ts'
import { MailSettingsStore } from '../db/mail-settings-store.ts'
import { PasswordResetStore } from '../db/password-reset-store.ts'
import { ImageStore } from '../db/image-store.ts'
import { YouthStore } from '../db/youth-store.ts'
import { PluginStore } from '../db/plugin-store.ts'
import { DAY_MS } from '../../shared/time.ts'
import { loadRules } from '../game/rules.ts'
import { loadCatalog } from '../news/catalog.ts'
import { ArticleImages } from '../news/article-images.ts'
import { ServerInboxStore } from '../db/server-inbox-store.ts'
import { SourceReviewStore } from '../db/source-review-store.ts'
import { ServerNoticeStore } from '../db/server-notice-store.ts'
import type { Outside } from './outside.ts'

// The stores over Hodi's database, and the nightly upkeep of what they keep (start.ts).
export const openStores = (
  config: Config,
  {
    db,
    outside,
    forgetLog,
    pluginBackup
  }: { db: Database; outside: Outside; forgetLog: ForgetLog; pluginBackup: PluginBackup }
) => {
  // Serveur › Contenu: how long the server keeps what it fetches.
  const serverSettings = new ServerSettingsStore(db)
  const textRetention = () => serverSettings.content().textDays * DAY_MS
  const store = new NewsStore(db, textRetention)
  const profiles = new ProfileStore(db)
  // Each profile's state; the first one's also prunes them all and keeps the devices' push subscriptions.
  const users = new UserStore(db)
  // Article pictures made smaller, in the data folder beside the database.
  const images = new ArticleImages({
    store: new ImageStore(db, textRetention),
    fetchBytes: outside.fetchPictures,
    dir: path.join(path.dirname(config.databaseFile), 'images')
  })
  startMaintenance({
    db,
    stores: [store, users, images, forgetLog],
    backupDir: config.backupDir,
    kept: () => serverSettings.backupCopies(),
    plugins: pluginBackup
  })
  const household = new HouseholdStore(db)
  const accounts = new UserAccountStore(db)
  // Serveur › Vue d'ensemble's days run in the household's time zone, else the install's.
  const timeZone = () => household.get().timeZone ?? config.timeZone
  // A reader's days (a young profile's hours, the points of the game) run in its account's, else that one.
  const readerTimeZone = (profileId?: number) =>
    (profileId === undefined ? null : accounts.timeZoneOfProfile(profileId)) ?? timeZone()
  // The database's catalogue, filled once from sources.yml's base sources in the household's language (at setup on a
  // new install), with the sources profiles added.
  const sources = new SourceStore(db)
  const file = loadCatalog(config.sourcesFile)
  return {
    serverSettings,
    store,
    profiles,
    users,
    usersOf: (profileId: number) => new UserStore(db, profileId),
    images,
    household,
    accounts,
    accountAi: new AccountAiStore(db),
    handles: new HandleStore(db),
    codes: new SignInCodeStore(db, config.sessionSecret),
    twoFactor: new TwoFactorStore(db, config.sessionSecret),
    devices: new UserDeviceStore(db),
    profileDevices: new ProfileDeviceStore(db),
    accountData: new AccountDataStore(db),
    youth: new YouthStore(db, readerTimeZone),
    serverPeople: new ServerPeopleStore(db),
    serverStats: new ServerStatsStore(db, timeZone),
    // The server's time zone: its household's, else the install's.
    timeZone,
    sources,
    file,
    catalog: sources.load(file, Date.now(), household.isSetUp() ? household.get().language : null),
    // The household game's rules, next to sources.yml; points follow each reader's days.
    game: new GameStore(db, loadRules(path.resolve('gamification.yml')), readerTimeZone),
    mailSettings: new MailSettingsStore(db),
    serverNotices: new ServerNoticeStore(db),
    serverInbox: new ServerInboxStore(db),
    sourceReviews: new SourceReviewStore(db),
    passwordResets: new PasswordResetStore(db, config.sessionSecret),
    pluginStore: new PluginStore(db)
  }
}

export type Stores = ReturnType<typeof openStores>
