import type express from 'express'
import { DEFAULT_ACCOUNT_ID, inHousehold } from '../db/household-scope.ts'
import { publicServerSettings } from '../db/server-settings-store.ts'
import { codeJoinRoutes } from '../http/code-routes.ts'
import { setupRoutes } from '../http/setup-routes.ts'
import { loginRoutes } from '../http/login-routes.ts'
import { passwordRoutes } from '../http/password-routes.ts'
import { pluginDevRoutes, pluginPublicRoutes } from '../http/plugin-routes.ts'
import type { Wiring } from './wiring.ts'

type Login = ReturnType<typeof loginRoutes>

// « Mot de passe oublié »: as a login, its own profile opens at once.
const mountPassword = (api: express.Router, { options }: Wiring, login: Login) => {
  const { accounts, devices, serverMail, passwordResets, household, news, now } = options
  if (!accounts || !devices || !serverMail || !passwordResets) return
  api.use(
    '/password',
    passwordRoutes({
      mail: serverMail.store,
      send: serverMail.send,
      resets: passwordResets,
      accounts,
      languageOf: account =>
        inHousehold(accounts.householdOf(account.id) ?? DEFAULT_ACCOUNT_ID, () => {
          const profileId = accounts.profileOf(account.id)
          return profileId === null ? household.get().language : news.languageOf(profileId)
        }),
      checkSignIn: login.checkSignIn,
      signIn: (account, hash, request) => {
        const session = login.resetAccountPassword(account, hash, request)
        if (session === null) return []
        const cookies = [session]
        const own = login.ownProfileCookie(account.id)
        if (own) cookies.push(own)
        return cookies
      },
      now
    })
  )
}

// "J'ai un code", from a device signed in with nothing.
const mountCodeJoin = (api: express.Router, wiring: Wiring, login: Login) => {
  const { accounts, codes, profiles, household, throttle, now, profileDevices, devices, twoFactor } = wiring.options
  if (!accounts || !codes || !profiles) return
  api.use(
    '/codes',
    codeJoinRoutes({
      codes,
      accounts,
      profiles,
      household,
      throttle,
      secret: wiring.config.sessionSecret,
      now,
      cookieFor: wiring.session.cookieFor,
      linkDevice: profileDevices ? wiring.linkedDevices.link : undefined,
      resetPassword: devices ? login.resetAccountPassword : undefined,
      signsInHere: account => !twoFactor?.isOn(account.id),
      checkSignIn: login.checkSignIn,
      onProfileCreated: id => wiring.profileHooks.created(id)
    })
  )
}

// Plugins' routes open to anyone, before any session is read: they never learn who is signed in on the device.
// They open once the setup is over: a household made, or the server's admin gone on without one.
const mountPublicPlugins = (api: express.Router, wiring: Wiring, login: Login) => {
  const { plugins, household, serverSettings, accounts, twoFactor, now } = wiring.options
  if (!plugins) return
  api.use(
    '/public/plugins',
    pluginPublicRoutes(plugins, {
      isOpen: () => household.isSetUp() || Boolean(serverSettings?.householdLater()),
      // A plugin's signIn, once Hodi checked the account: as a login, its own profile opens at once.
      signIn: async (accountId, request) => {
        const account = accounts?.get(accountId)
        // The server's admin never signs in through a plugin.
        if (!account || account.serverAdmin) return null
        const refusal = await login.checkSignIn(account)
        if (refusal) return { refusal }
        // A plugin's word stands for the password, never for the app's code: Hodi asks for it in its own dialog.
        if (twoFactor?.isOn(account.id)) return { secondStep: login.secondStepTickets.issue(account.id, now()) }
        const cookies = [wiring.session.cookieFor(account, request)]
        const own = login.ownProfileCookie(account.id)
        if (own) cookies.push(own)
        return { cookies }
      }
    })
  )
}

// Everything that answers before the session check: setup, sign-in, codes and the plugins' public routes.
export const mountSignedOut = (api: express.Router, wiring: Wiring) => {
  const { options, config, householdOptions } = wiring
  const { accounts, devices, profiles, profileDevices, plugins, pluginInstaller, twoFactor, throttle, now } = options
  if (householdOptions) api.use('/setup', setupRoutes(householdOptions))

  const login = loginRoutes({
    accounts,
    devices,
    profiles,
    profileDevices,
    plugins,
    twoFactor,
    throttle,
    cookieFor: wiring.session.cookieFor,
    linkedDevices: wiring.linkedDevices,
    secret: config.sessionSecret,
    now
  })

  // What Serveur › Contenu and Sauvegardes promise, for anyone: a plugin's legal pages say it, signed in or not.
  const { serverSettings } = options
  if (serverSettings) {
    api.get('/server-settings', (_request, response) => {
      response.set('Cache-Control', 'no-cache')
      response.json(publicServerSettings(serverSettings))
    })
  }

  api.use(login.router)
  mountPassword(api, wiring, login)
  mountCodeJoin(api, wiring, login)
  // « npx hodi-plugin dev », with the code of Serveur › Plugins › Mode développeur: before any session.
  if (plugins && pluginInstaller) api.use('/dev', pluginDevRoutes(plugins, pluginInstaller))
  mountPublicPlugins(api, wiring, login)
}
