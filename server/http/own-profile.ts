import { DEFAULT_ACCOUNT_ID, inHousehold } from '../db/household-scope.ts'
import {
  MAX_NAME_LENGTH,
  type ProfileColor,
  type ProfileStore,
  cleanName,
  profileColorOf
} from '../db/profile-store.ts'
import type { UserAccount, UserAccountStore } from '../db/user-account-store.ts'

// The name a new profile takes from its account: the one it wore before, or the start of its e-mail.
const nameOf = (account: UserAccount) => {
  const start = (account.email ?? account.handle ?? '').split('@')[0]!.replace(/[._-]+/g, ' ')
  const name = cleanName(start.slice(0, MAX_NAME_LENGTH))
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : 'Hodi'
}

const identityOf = (accounts: UserAccountStore, account: UserAccount): { name: string; color: ProfileColor } => {
  const worn = accounts.identityOf(account.id)
  return { name: worn?.name ?? nameOf(account), color: profileColorOf(worn?.color) ?? 'world' }
}

// The profile the setup keeps for the server's admin, when their setup went on without it (« Plus tard »).
const waitingFor = (profiles: ProfileStore, account: UserAccount) =>
  account.serverAdmin ? profiles.list().find(profile => profile.role === 'admin' && !profile.hasAccount) : undefined

// Every account reads with a profile of its own. One without (made by a plugin, or whose profile was deleted) gets it
// as it signs in, and changes its name and colour in Réglages like any other. Returns the household it reads in. All of
// it runs at once, with nothing awaited, so two requests of the same device never both find it without a profile.
export const giveOwnProfile = (
  accounts: UserAccountStore,
  profiles: ProfileStore,
  account: UserAccount,
  { now, onProfileCreated }: { now: () => number; onProfileCreated?: (profileId: number) => void }
) => {
  const known = accounts.householdOf(account.id)
  if (known !== null) return known
  return inHousehold(DEFAULT_ACCOUNT_ID, () => {
    const { name, color } = identityOf(accounts, account)
    const waiting = waitingFor(profiles, account)
    const profile = waiting ? profiles.update(waiting.id, { name, color }) : profiles.create(name, color, now())
    if (!profile) return null
    accounts.linkProfile(account.id, profile.id)
    if (!waiting) onProfileCreated?.(profile.id)
    return DEFAULT_ACCOUNT_ID
  })
}
