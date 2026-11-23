import type { Config } from '../config.ts'
import type { InstallStore } from '../db/install-store.ts'
import type { MailSettingsStore } from '../db/mail-settings-store.ts'
import type { ServerSettingsStore } from '../db/server-settings-store.ts'
import type { ServerInboxStore } from '../db/server-inbox-store.ts'
import type { ServerNoticeStore } from '../db/server-notice-store.ts'
import type { UserAccountStore } from '../db/user-account-store.ts'
import { smtpSend } from '../mail/mailer.ts'
import type { ServerStatsStore } from '../db/server-stats-store.ts'
import { type ServerNotifier, serverNotifier } from '../notices/server-notifier.ts'
import { weeklyReport } from '../notices/weekly-report.ts'
import type { PluginRegistry } from '../plugins/registry.ts'
import type { Outside } from './outside.ts'

// What happens on the server, told to its admins as each chose in Serveur › Notifications (start.ts).
export const createServerNotifier = ({
  config,
  outside,
  serverNotices,
  serverInbox,
  accounts,
  mailSettings,
  serverSettings,
  install
}: {
  config: Config
  outside: Outside
  serverNotices: ServerNoticeStore
  serverInbox: ServerInboxStore
  accounts: UserAccountStore
  mailSettings: MailSettingsStore
  serverSettings: ServerSettingsStore
  install: InstallStore
}) =>
  serverNotifier({
    store: serverNotices,
    inbox: serverInbox,
    admins: () => accounts.serverAdmins(),
    mail: { settings: () => mailSettings.get(), send: smtpSend, home: () => serverSettings.publicHome() },
    push: (target, payload) => outside.sendPush(target, payload, config.vapid),
    // The server's language, chosen at setup.
    languageOf: () => install.get().language,
    log: console.warn
  })

// « Rapport de la semaine », on Monday from 08:00 in the server's time zone (start.ts).
export const startWeeklyReport = ({
  notifier,
  serverStats,
  serverSettings,
  plugins,
  timeZone
}: {
  notifier: ServerNotifier
  serverStats: ServerStatsStore
  serverSettings: ServerSettingsStore
  plugins: PluginRegistry
  timeZone: () => string
}) => {
  const report = weeklyReport({
    week: week => serverStats.overview(week, Date.now()),
    plugins: week => plugins.weeklyReports(week),
    notifier,
    sent: () => serverSettings.weeklyReportSent(),
    markSent: monday => serverSettings.setWeeklyReportSent(monday),
    timeZone,
    log: console.warn
  })
  report.start()
  return report
}
