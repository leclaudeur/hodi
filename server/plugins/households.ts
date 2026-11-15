import { inHousehold } from '../db/household-scope.ts'
import { cleanHouseholdName } from '../db/household-store.ts'
import { cleanName } from '../db/profile-store.ts'
import type { PluginHouseholdStore, StoredHousehold } from '../db/plugin-household-store.ts'
import type { SignInCodeStore } from '../db/sign-in-code-store.ts'
import type { UserAccountStore } from '../db/user-account-store.ts'
import { isLanguage } from '../../shared/i18n.ts'
import type { PluginHousehold } from './api.ts'

// ctx.households: the server's households as a plugin with permissions.households sees and makes them. It never reads
// what a household holds (its profiles' reading, its settings), and only touches the households it made itself.

// What the app does for a household and its profiles, which the plugin's households need too. app.ts fills it in once
// it is made: until then, nothing beyond the rows.
export interface HouseholdHooks {
  // Its base sources, in its language, run in that household.
  setUp: (language: 'fr' | 'en') => void
  profileCreated: (profileId: number) => void
  profileDeleted: (profileId: number) => void
  // Once it is gone: the plugins forget what they kept of it.
  removed: (householdId: number) => void
}

export const householdHooks = (): HouseholdHooks => ({
  setUp: () => {},
  profileCreated: () => {},
  profileDeleted: () => {},
  removed: () => {}
})

export interface PluginHouseholds {
  list: (plugin: string) => PluginHousehold[]
  get: (plugin: string, id: unknown) => PluginHousehold | null
  of: (plugin: string, accountId: unknown) => PluginHousehold[]
  create: (plugin: string, value: unknown) => PluginHousehold & { code: { code: string; expiresAt: number } | null }
  suspend: (plugin: string, id: unknown) => void
  resume: (plugin: string, id: unknown) => void
  remove: (plugin: string, id: unknown) => void
}

const unavailable = () => {
  throw new Error('households_unavailable')
}

// No store at all (tests that do not need one): every call is refused.
export const NO_HOUSEHOLDS: PluginHouseholds = {
  list: unavailable,
  get: unavailable,
  of: unavailable,
  create: unavailable,
  suspend: unavailable,
  resume: unavailable,
  remove: unavailable
}

const idOf = (value: unknown) => (typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null)

// A new household as a plugin asks for it. Its admin: an account that joins at once, or a first name whose profile
// waits for a code; without one, the profile is « Admin » and waits for a code too. Throws on anything else.
const newHouseholdOf = (value: unknown) => {
  const {
    name: typedName,
    language: typedLanguage = 'fr',
    admin = null,
    ...rest
  } = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const name = cleanHouseholdName(typedName)
  const language = isLanguage(typedLanguage) ? typedLanguage : null
  if (Object.keys(rest).length > 0 || !name || !language) throw new Error('invalid_household')
  const { name: typedAdmin, accountId: typedAccount = null } = (
    typeof admin === 'object' && admin !== null ? admin : {}
  ) as Record<string, unknown>
  if (admin !== null && typeof admin !== 'object') throw new Error('invalid_household')
  const adminName = admin === null ? 'Admin' : cleanName(typedAdmin)
  const accountId = typedAccount === null ? null : idOf(typedAccount)
  if (!adminName || (typedAccount !== null && accountId === null)) throw new Error('invalid_household')
  return { name, language, adminName, accountId }
}

export const pluginHouseholds = ({
  store,
  accounts,
  codes,
  hooks,
  now = Date.now
}: {
  store: PluginHouseholdStore
  accounts: UserAccountStore
  codes: SignInCodeStore
  hooks: HouseholdHooks
  now?: () => number
}): PluginHouseholds => {
  const view = (plugin: string, household: StoredHousehold): PluginHousehold => ({
    id: household.id,
    name: household.name,
    language: isLanguage(household.language) ? household.language : 'fr',
    createdAt: household.createdAt,
    suspended: household.suspendedAt !== null,
    mine: household.madeByPlugin === plugin,
    photo: household.photoVersion === null ? null : `/api/households/${household.id}/photo?v=${household.photoVersion}`
  })

  // Suspend, resume and remove: only what this plugin made; anything else is refused alike, so the plugin learns
  // nothing more of another household than list() tells.
  const ownOrRefuse = (plugin: string, value: unknown) => {
    const id = idOf(value)
    const household = id === null ? null : store.get(id)
    if (!household || household.madeByPlugin !== plugin) throw new Error('not_allowed')
    return household
  }

  return {
    list: plugin => store.list().map(household => view(plugin, household)),
    get: (plugin, value) => {
      const id = idOf(value)
      const household = id === null ? null : store.get(id)
      return household && view(plugin, household)
    },
    of: (plugin, value) => {
      const id = idOf(value)
      return id === null ? [] : store.of(id).map(household => view(plugin, household))
    },
    create: (plugin, value) => {
      const { name, language, adminName, accountId } = newHouseholdOf(value)
      if (accountId !== null) {
        const account = accounts.get(accountId)
        // The server's admin enters a household only by their own choice: a plugin never puts them in one.
        if (!account || account.serverAdmin) throw new Error('invalid_household')
      }
      const made = store.create({ name, language, plugin, admin: { name: adminName, accountId } }, now())
      const household = made.household
      inHousehold(household.id, () => {
        hooks.setUp(language)
        hooks.profileCreated(made.adminProfileId)
      })
      const code =
        accountId === null
          ? codes.create({ profileId: made.adminProfileId, createdBy: null, householdId: household.id }, now())
          : null
      return { ...view(plugin, household), code }
    },
    suspend: (plugin, value) => {
      store.setSuspended(ownOrRefuse(plugin, value).id, plugin, now())
    },
    resume: (plugin, value) => {
      store.setSuspended(ownOrRefuse(plugin, value).id, plugin, null)
    },
    remove: (plugin, value) => {
      const household = ownOrRefuse(plugin, value)
      for (const profileId of store.profileIds(household.id)) {
        inHousehold(household.id, () => hooks.profileDeleted(profileId))
      }
      store.remove(household.id, plugin)
      hooks.removed(household.id)
    }
  }
}
