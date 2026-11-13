import type express from 'express'
import { LoginThrottle } from '../auth/login-throttle.ts'
import type { AppOptions } from '../app-options.ts'
import type { Config } from '../config.ts'
import { accountSession } from '../http/account-session.ts'
import { Presence } from '../http/presence.ts'
import { profileDeviceSession } from '../http/profile-device-session.ts'
import { PIN_GLOBAL_MAX_FAILURES, PIN_MAX_FAILURES } from '../http/profile-routes.ts'
import { accountAsking, askingWithProof, proofCheck, type CheckProof } from '../http/proof.ts'
import type { RouteProof } from '../http/plugin-routes.ts'
import { readerContext, type ReaderContext } from '../http/reader-context.ts'
import { AI_PROVIDERS } from '../news/ai-providers.ts'
import { YouthSources } from '../news/youth-sources.ts'
import { householdOptionsOf } from './household-options.ts'
import { profileHooksOf, type ProfileHooks } from './profile-hooks.ts'

// AppOptions with the defaults a real server uses filled in.
export type Options = AppOptions &
  Required<Pick<AppOptions, 'setupCode' | 'aiProviders' | 'onHouseholdChange' | 'now' | 'throttle' | 'pinThrottle'>>

// What the route groups share, built once by createApp.
export interface Wiring {
  config: Config
  options: Options
  // Who has Hodi open now, in memory only.
  presence: Presence
  session: ReturnType<typeof accountSession>
  linkedDevices: ReturnType<typeof profileDeviceSession>
  // The person's own password before what cannot be undone (proof.ts).
  checkProof: CheckProof
  // In /server, the server admin's « Validation en deux étapes » must be on too.
  serverProof: (request: express.Request, response: express.Response) => Promise<unknown>
  pluginRouteProof: RouteProof
  householdOptions: ReturnType<typeof householdOptionsOf>
  // A young profile's sources and themes, its parents' choice.
  youthSources: YouthSources | null
  reader: ReaderContext
  profileHooks: ProfileHooks
}

const withDefaults = (options: AppOptions): Options => ({
  ...options,
  setupCode: options.setupCode ?? '',
  aiProviders: options.aiProviders ?? AI_PROVIDERS,
  onHouseholdChange: options.onHouseholdChange ?? (() => {}),
  now: options.now ?? Date.now,
  throttle: options.throttle ?? new LoginThrottle(),
  pinThrottle: options.pinThrottle ?? new LoginThrottle(PIN_MAX_FAILURES, undefined, PIN_GLOBAL_MAX_FAILURES)
})

const proofsOf = (options: Options, session: Wiring['session']) => {
  const { accounts, twoFactor, throttle, now } = options
  const checkProof = proofCheck({ throttle, now, sessionOf: session.sessionOf, twoFactor })
  // 403 two_factor_setup until the server admin's second step is on.
  const serverProof = async (request: express.Request, response: express.Response) => {
    const account = accounts ? accountAsking(response, accounts) : null
    if (account && twoFactor && !twoFactor.isOn(account.id)) {
      response.status(403).json({ error: 'two_factor_setup' })
      return null
    }
    return accounts ? askingWithProof(checkProof, accounts, request, response) : null
  }
  // A plugin's route marked proof: true, with what Hodi's dialog typed: the password (and code) of whoever asks.
  const pluginRouteProof: RouteProof = async (request, response, { password, code }) => {
    const account = accounts ? accountAsking(response, accounts) : null
    if (!account) {
      response.status(403).json({ error: 'account_only' })
      return false
    }
    return checkProof(account, request, response, password, code)
  }
  return { checkProof, serverProof, pluginRouteProof }
}

const youthSourcesOf = ({ youth, sources, users, profiles, news, now }: Options) =>
  youth && sources && users && profiles
    ? new YouthSources({
        youth,
        news,
        store: sources.store,
        file: sources.file,
        users,
        profiles: () => profiles.list(),
        now
      })
    : null

export const wiringOf = (config: Config, appOptions: AppOptions): Wiring => {
  const options = withDefaults(appOptions)
  const { accounts, devices, profileDevices, news, users, profiles, now } = options
  const session = accountSession(accounts, devices, config.sessionSecret, now)
  const youthSources = youthSourcesOf(options)
  const householdOptions = householdOptionsOf(config, options, session)
  return {
    config,
    options,
    presence: new Presence(),
    session,
    linkedDevices: profileDeviceSession(profileDevices, config.sessionSecret, now),
    ...proofsOf(options, session),
    householdOptions,
    youthSources,
    reader: readerContext({ news, users, profiles, youthSources }),
    profileHooks: profileHooksOf(options, youthSources)
  }
}
