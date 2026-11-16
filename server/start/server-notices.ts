import type { Config } from '../config.ts'
import type { HouseholdStore } from '../db/household-store.ts'
import { inHousehold } from '../db/household-scope.ts'
import type { MailSettingsStore } from '../db/mail-settings-store.ts'
import type { ServerNoticeStore } from '../db/server-notice-store.ts'
import type { UserAccountStore } from '../db/user-account-store.ts'
import { smtpSend } from '../mail/mailer.ts'
import { serverNotifier } from '../notices/server-notifier.ts'
import type { Outside } from './outside.ts'

// What happens on the server, told to its admins as each chose in Serveur › Notifications (start.ts).
export const createServerNotifier = ({
  config,
  outside,
  serverNotices,
  accounts,
  mailSettings,
  household
}: {
  config: Config
  outside: Outside
  serverNotices: ServerNoticeStore
  accounts: UserAccountStore
  mailSettings: MailSettingsStore
  household: HouseholdStore
}) =>
  serverNotifier({
    store: serverNotices,
    admins: () => accounts.serverAdmins(),
    mail: { settings: () => mailSettings.get(), send: smtpSend },
    push: (target, payload) => outside.sendPush(target, payload, config.vapid),
    // The language of the admin's household; an admin outside any household reads French, Hodi's own.
    languageOf: account => {
      const householdId = accounts.householdOf(account.id)
      return householdId === null ? 'fr' : inHousehold(householdId, () => household.get().language)
    },
    log: console.warn
  })
