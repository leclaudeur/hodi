import express from 'express'
import type { InstallStore } from '../db/install-store.ts'
import type { ServerSettingsStore } from '../db/server-settings-store.ts'
import type { TwoFactorStore } from '../db/two-factor-store.ts'
import type { UserAccountStore } from '../db/user-account-store.ts'
import { accountAsking } from './proof.ts'

// What the app reads as it starts: who reads, and how the server writes the time.
export const sessionRoutes = ({
  accounts,
  install,
  serverSettings,
  twoFactor
}: {
  accounts?: UserAccountStore
  install: InstallStore
  serverSettings?: ServerSettingsStore
  twoFactor?: TwoFactorStore
}) => {
  const router = express.Router()

  router.get('/session', (_request, response) => {
    const asking = accounts ? accountAsking(response, accounts) : null
    response.json({
      authenticated: true,
      profileChosen: response.locals.profileChosen === true,
      language: install.get().language,
      hourCycle: install.get().hourCycle,
      // How long an article stays in the lists and a video in Vidéos, for the pages that say so.
      ...(serverSettings
        ? {
            content: {
              articleDays: serverSettings.content().articleDays,
              videoDays: serverSettings.content().videoDays,
              backupCopies: serverSettings.backupCopies()
            }
          }
        : {}),
      // « Validation en deux étapes » of the account reading here: its code goes with its password at the moments
      // that ask for it, and /server opens only once it is on.
      ...(twoFactor && asking ? { twoFactor: twoFactor.isOn(asking.id) } : {}),
      // true: an account with no password of its own (« Se connecter avec Google »): the moments that ask for the
      // password take a recent sign-in instead.
      ...(asking && !asking.hasPassword ? { noPassword: true } : {})
    })
  })

  return router
}
