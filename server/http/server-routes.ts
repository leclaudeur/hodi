import express from 'express'
import type { AccountDataStore } from '../db/account-data.ts'
import type { HouseholdStore } from '../db/household-store.ts'
import { MAX_PROFILES, type ProfileStore } from '../db/profile-store.ts'
import type { ServerPeopleStore } from '../db/server-people-store.ts'
import {
  CONTENT_SETTINGS,
  type ContentSettings,
  type ServerSettingsStore,
  isContentKey,
  isValidContent,
  isValidMaxSources,
  MAX_SOURCES
} from '../db/server-settings-store.ts'
import type { Period, ServerStatsStore } from '../db/server-stats-store.ts'
import type { SignInCodeStore } from '../db/sign-in-code-store.ts'
import type { UserAccountStore } from '../db/user-account-store.ts'
import type { Presence } from './presence.ts'
import { profileIdOf } from './profile-routes.ts'
import { type CheckProof, accountAsking, askingWithProof } from './proof.ts'
import { type Backups, mountBackupRoutes } from './server-backup-routes.ts'
import { mountAccountCodeRoute } from './server-account-code-route.ts'
import { mountGeneralRoutes } from './server-general-routes.ts'
import { accountRemover, mountDeletionRoutes } from './server-deletion-routes.ts'
import { type SourceBlockOptions, mountSourceBlockRoutes } from './source-block-routes.ts'

// The server's own space (#/server), for its admin only: requireServerAdmin stands in front of these.

// The period's quick choices, in days; 0 is « Tout ». Any other period comes as two dates.
const PERIODS = new Set([7, 30, 90, 365, 0])
const DATE = /^\d{4}-\d{2}-\d{2}$/

// ?days=7 or ?from=2026-10-03&to=2026-11-06; null when neither is right.
const periodOf = (query: express.Request['query']): Period | null => {
  const { from, to, days } = query
  if (typeof from === 'string' && typeof to === 'string') {
    const real = (day: string) => DATE.test(day) && new Date(`${day}T12:00:00Z`).toISOString().startsWith(day)
    return real(from) && real(to) && from <= to ? { from, to } : null
  }
  const length = Number(days ?? 7)
  return PERIODS.has(length) ? { days: length } : null
}

export interface ServerRoutesOptions {
  stats: ServerStatsStore
  presence: Presence
  people?: ServerPeopleStore
  codes?: SignInCodeStore
  settings?: ServerSettingsStore
  backups?: Backups
  accounts?: UserAccountStore
  profiles?: ProfileStore
  household?: HouseholdStore
  // The server admin's own password, before what cannot be undone: a copy of the server, « Restaurer », a code for a
  // new password, deleting an account or a household. Absent in tests without accounts.
  checkProof?: CheckProof
  // « Mot de passe oublié » without e-mail: when an account asked for a code, while it waits; and done, once one is made.
  codeRequests?: { askedAt: (accountId: number) => number | null; handled: (accountId: number) => void }
  // false: the server admin has not turned « Validation en deux étapes » on yet, which these moments need first.
  twoFactorOn?: (accountId: number) => boolean
  // « Bloquer » a source, and Sources bloquées.
  blocks?: SourceBlockOptions
  // Comptes and Foyers › « Supprimer ».
  deletions?: {
    data: AccountDataStore
    // What else goes with a profile (its devices' alerts, the sources it added), read in its household.
    onProfileDeleted: (profileId: number) => void
    // The plugins forget an account, and a household that went.
    onAccountDeleted: (accountId: number) => void
    onHouseholdGone: (householdId: number) => void
  }
  now: () => number
}

export const serverRoutes = (options: ServerRoutesOptions) => {
  const router = express.Router()
  const helpers = serverHelpers(options)
  mountOverviewRoute(router, options)
  mountPeopleRoutes(router, options)
  mountInviteRoutes(router, options, helpers)
  mountAccountCodeRoute(router, options, helpers)
  mountDeletionRoutes(router, options, helpers)
  const { blocks, accounts: accountStore } = options
  if (blocks && accountStore)
    mountSourceBlockRoutes(router, blocks, {
      accounts: accountStore,
      proven: helpers.proven,
      removeAccount: accountRemover(options),
      now: options.now
    })
  mountContentRoutes(router, options)
  if (options.settings) mountGeneralRoutes(router, options.settings)
  const { settings, backups, accounts, profiles, checkProof, now } = options
  if (settings && backups && accounts && profiles)
    mountBackupRoutes(router, { settings, backups, accounts, checkProof, now }, helpers.twoFactorReady)
  return router
}

const serverHelpers = ({ accounts, checkProof, twoFactorOn }: ServerRoutesOptions) => {
  // Who made a code: the open profile, or nobody when the server's admin has no profile in the household.
  const createdByOf = (response: express.Response) =>
    response.locals.serverOnly === true ? null : profileIdOf(response)

  // The proof of the account asking; false when the refusal was sent. Without accounts (older tests), nothing to give.
  const proven = async (request: express.Request, response: express.Response) => {
    if (!accounts || !checkProof) return true
    if (!twoFactorReady(response)) return false
    return (await askingWithProof(checkProof, accounts, request, response)) !== null
  }
  // 403 two_factor_setup while the server admin's « Validation en deux étapes » is off.
  const twoFactorReady = (response: express.Response) => {
    const account = accounts ? accountAsking(response, accounts) : null
    if (!account || !twoFactorOn || twoFactorOn(account.id)) return true
    response.status(403).json({ error: 'two_factor_setup' })
    return false
  }

  return { createdByOf, proven, twoFactorReady }
}

export type ServerHelpers = ReturnType<typeof serverHelpers>

const mountOverviewRoute = (
  router: express.Router,
  { stats, presence, profiles, household, now }: ServerRoutesOptions
) => {
  // Vue d'ensemble: totals over a period, and who is online, by first name, household and device.
  router.get('/overview', (request, response) => {
    const period = periodOf(request.query)
    if (!period) {
      response.status(400).json({ error: 'invalid_request' })
      return
    }
    const known = new Map((profiles?.list() ?? []).map(profile => [profile.id, profile.name]))
    const householdName = household?.get().name ?? ''
    response.json({
      ...stats.overview(period, now()),
      online: presence.online(now()).flatMap(({ profileId, device, since }) => {
        const name = known.get(profileId)
        return name === undefined ? [] : [{ name, household: householdName, device, since }]
      })
    })
  })
}

const mountPeopleRoutes = (router: express.Router, { people, codeRequests }: ServerRoutesOptions) => {
  if (!people) return
  // Comptes: who has an account, in which household, and when it was last used. Nothing they read.
  router.get('/households', (_request, response) => {
    response.json({
      households: people.households(),
      maxProfiles: MAX_PROFILES
    })
  })
  router.get('/accounts', (_request, response) => {
    response.json({
      accounts: people
        .accounts()
        .map(account => ({ ...account, codeAskedAt: codeRequests?.askedAt(account.id) ?? null }))
    })
  })
  // An account's profile photo, for its row, as a household's: the server's admin sees the accounts' names already.
  // ?v=<photoVersion>: a new photo has a new address, so each one is kept by the browser for good.
  router.get('/accounts/photos/:profileId', (request, response) => {
    const id = Number(request.params.profileId)
    const photo = Number.isInteger(id) ? people.accountPhoto(id) : null
    if (!photo) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    response.set('Content-Type', photo.type)
    response.set('Cache-Control', request.query.v ? 'private, max-age=31536000, immutable' : 'private, no-cache')
    response.send(photo.data)
  })
}

const mountInviteRoutes = (
  router: express.Router,
  { people, codes, profiles, now }: ServerRoutesOptions,
  { createdByOf }: ServerHelpers
) => {
  if (!people || !codes || !profiles) return
  // "Inviter un adulte" in a household: the same code as Réglages › Profils gives, valid once and for a day.
  router.post('/households/:id/code', (request, response) => {
    const id = Number(request.params.id)
    if (!people.households().some(entry => entry.id === id)) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    if (profiles.list().length >= MAX_PROFILES) {
      response.status(409).json({ error: 'household_full' })
      return
    }
    response.status(201).json(codes.create({ createdBy: createdByOf(response), householdId: id }, now()))
  })
}

const mountContentRoutes = (router: express.Router, { settings }: ServerRoutesOptions) => {
  if (!settings) return
  // Contenu: each duration with its bounds and default, so the page says them, and the sources limit.
  const content = () => ({
    values: settings.content(),
    bounds: CONTENT_SETTINGS,
    maxSources: { value: settings.maxSources(), ...MAX_SOURCES }
  })
  router.get('/content', (_request, response) => {
    response.json(content())
  })
  router.patch('/content', (request, response) => {
    const body: unknown = request.body
    const entries = body && typeof body === 'object' ? Object.entries(body) : []
    const durations = entries.filter(([key]) => key !== 'maxSources')
    const limit = entries.find(([key]) => key === 'maxSources')
    if (
      entries.length === 0 ||
      !durations.every(([key, value]) => isContentKey(key) && isValidContent(key, value)) ||
      (limit && !isValidMaxSources(limit[1]))
    ) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    if (durations.length > 0) settings.setContent(Object.fromEntries(durations) as Partial<ContentSettings>)
    if (limit) settings.setMaxSources(limit[1] as number | null)
    response.json(content())
  })
}
