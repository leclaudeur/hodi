import express from 'express'
import { type AccountDataStore, deletionPlan } from '../db/account-data.ts'
import { inHousehold } from '../db/household-scope.ts'
import { type HouseholdStore, cleanHouseholdName } from '../db/household-store.ts'
import { MAX_PROFILES, type ProfileStore, cleanName, isYoung } from '../db/profile-store.ts'
import { type Language, isLanguage } from '../../shared/i18n.ts'
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
import { sendHouseholdPhoto } from './household-photo.ts'
import { profileIdOf } from './profile-routes.ts'
import { type CheckProof, accountAsking, askingWithProof } from './proof.ts'
import { type Backups, mountBackupRoutes } from './server-backup-routes.ts'

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

interface ServerRoutesOptions {
  stats: ServerStatsStore
  presence: Presence
  people?: ServerPeopleStore
  codes?: SignInCodeStore
  settings?: ServerSettingsStore
  backups?: Backups
  accounts?: UserAccountStore
  profiles?: ProfileStore
  household?: HouseholdStore
  // A household made here for someone else: its base sources come in, in its language.
  onHouseholdSetUp?: (language: Language) => void
  // The server admin's own password, before what cannot be undone: a copy of the server, « Restaurer », a code for a
  // new password, deleting an account or a household. Absent in tests without accounts.
  checkProof?: CheckProof
  // false: the server admin has not turned « Validation en deux étapes » on yet, which these moments need first.
  twoFactorOn?: (accountId: number) => boolean
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
  mountDeletionRoutes(router, options, helpers)
  mountContentRoutes(router, options)
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

type ServerHelpers = ReturnType<typeof serverHelpers>

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

const mountPeopleRoutes = (
  router: express.Router,
  { people, codes, profiles, household, settings, onHouseholdSetUp, now }: ServerRoutesOptions
) => {
  if (!people) return
  // Foyers and Comptes: who has an account, in which household, and when it was last used. Nothing they read.
  // canCreate: the setup left the household for later, « Créer un foyer » takes it up again.
  router.get('/households', (_request, response) => {
    response.json({
      households: people.households(),
      maxProfiles: MAX_PROFILES,
      canCreate: household !== undefined && !household.isSetUp()
    })
  })
  // A household's photo, for its row: the server's admin sees the households' names already.
  router.get('/households/:id/photo', (request, response) => {
    if (household) sendHouseholdPhoto(household, Number(request.params.id), request, response)
    else response.status(404).json({ error: 'not_found' })
  })
  // No household yet. « Créer mon foyer »: the setup's household steps come back, for the server's admin. « Créer
  // un foyer » for someone else: its name and the first name of its admin, whose profile waits for that person
  // with a code (« J'ai un code »). The server's admin never enters it by itself.
  router.post('/households', (request, response) => {
    if (!household || household.isSetUp()) {
      response.status(409).json({ error: 'already_set_up' })
      return
    }
    const body = (request.body ?? {}) as Record<string, unknown>
    if (body.for !== 'other') {
      settings?.setHouseholdLater(false)
      response.status(204).end()
      return
    }
    const name = cleanHouseholdName(body.name)
    const adminName = cleanName(body.admin)
    const language = body.language === undefined ? 'fr' : isLanguage(body.language) ? body.language : null
    const first = profiles?.list().find(profile => profile.role === 'admin')
    if (!name || !adminName || !language || !first || !codes) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    if (!household.setUp({ name, timeZone: null, country: null, language, ai: null }, now())) {
      response.status(409).json({ error: 'already_set_up' })
      return
    }
    settings?.setHouseholdLater(false)
    profiles!.update(first.id, { name: adminName })
    onHouseholdSetUp?.(language)
    const code = codes.create({ profileId: first.id, createdBy: null }, now())
    response.status(201).json({ profile: { id: first.id, name: adminName }, ...code })
  })
  router.get('/accounts', (_request, response) => {
    response.json({ accounts: people.accounts() })
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
  { createdByOf, proven }: ServerHelpers
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

  // « Refaire son code »: a household made for someone else whose admin has not used the first code yet (lost, or
  // past its 24 h). The new code replaces it.
  router.post('/households/:id/admin-code', (request, response) => {
    const id = Number(request.params.id)
    const admin = profiles.list().find(profile => profile.role === 'admin')
    if (!people.households().some(entry => entry.id === id) || !admin) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    if (people.accounts().some(account => account.profile?.id === admin.id)) {
      response.status(409).json({ error: 'admin_has_account' })
      return
    }
    const code = codes.create({ profileId: admin.id, createdBy: createdByOf(response), householdId: id }, now())
    response.status(201).json({ profile: { id: admin.id, name: admin.name }, ...code })
  })

  // "Mot de passe oublié" for an adult's account: a code that lets that person choose a new password. One's own
  // password changes in Réglages › Compte et données, with the current one.
  router.post('/accounts/:id/code', async (request, response) => {
    const account = people.accounts().find(entry => entry.id === Number(request.params.id))
    const profile = account?.profile ? profiles.get(account.profile.id) : null
    if (!account || !profile || isYoung(profile)) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    if (profile.id === profileIdOf(response)) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    if (!(await proven(request, response))) return
    response
      .status(201)
      .json(codes.create({ profileId: profile.id, createdBy: createdByOf(response), reset: true }, now()))
  })
}

const mountDeletionRoutes = (
  router: express.Router,
  { people, accounts, profiles, household, deletions, now }: ServerRoutesOptions,
  { proven }: ServerHelpers
) => {
  if (!people || !accounts || !profiles || !household || !deletions) return
  const { data, onProfileDeleted, onAccountDeleted, onHouseholdGone } = deletions
  const householdNames = () => new Map(people.households().map(entry => [entry.id, entry.name]))

  // « Supprimer » an account: its profile in each household it reads in, or the whole household with its last adult
  // who has an account, then the account and its devices. Never the server's admin's own: Compte et données.
  router.delete('/accounts/:id', async (request, response) => {
    const account = accounts.get(Number(request.params.id))
    if (!account) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    if (account.serverAdmin) {
      response.status(403).json({ error: 'server_admin' })
      return
    }
    if (!(await proven(request, response))) return
    // After the password, which takes a moment: what goes is read as it is now.
    const names = householdNames()
    const plans = data.householdsOf(account.id).map(householdId => ({
      householdId,
      plan: inHousehold(householdId, () =>
        deletionPlan(account, accounts, profiles, names.get(householdId) ?? '', householdId)
      )
    }))
    for (const { householdId, plan } of plans)
      inHousehold(householdId, () => plan.profiles.forEach(profile => onProfileDeleted(profile.id)))
    const { accounts: gone, households } = data.deleteFromServer(account, plans, now())
    gone.forEach(onAccountDeleted)
    households.forEach(onHouseholdGone)
    response.status(204).end()
  })

  // « Supprimer » a household: its profiles and all they read and kept, and the accounts that read nowhere else.
  router.delete('/households/:id', async (request, response) => {
    const id = Number(request.params.id)
    if (!people.households().some(entry => entry.id === id)) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    if (!(await proven(request, response))) return
    inHousehold(id, () => profiles.list().forEach(profile => onProfileDeleted(profile.id)))
    data.deleteHousehold(id, now()).forEach(onAccountDeleted)
    onHouseholdGone(id)
    response.status(204).end()
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
