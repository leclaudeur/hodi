import { currentHouseholdId } from '../db/household-scope.ts'
import type { PluginAiStatus } from './ai.ts'

// What the call that led to a plugin's request was for: the household it runs for, or null when it runs for none (the
// server's admin outside any household).
export interface CallContext {
  householdId: number | null
  // The address the request came from, for the sign-in throttle; absent for a hook, which no request led to.
  client?: string
  // The accounts this call made, checked the password of or found by its login: the only ones its answer may sign in.
  vouched: Set<number>
  // A click on the plugin's AiButton (an aiAction call): who clicked, and whether its one question was asked.
  ai?: AiTicket
}

export interface AiTicket {
  householdId: number
  profileId: number
  used: boolean
  outcome: PluginAiStatus | null
}

// A household-scoped request (ctx.articles) only runs for the call that made it: work a plugin left running after
// its call ended, or a call made for no household, is refused rather than read in some household.
export const householdOf = (context: unknown) => {
  const householdId = typeof context === 'object' && context !== null ? (context as CallContext).householdId : null
  if (typeof householdId !== 'number') throw new Error('no_household')
  return householdId
}

export const callContext = (householdId: number | null = currentHouseholdId(), client?: string): CallContext => ({
  householdId,
  ...(client === undefined ? {} : { client }),
  vouched: new Set()
})

// An account the call vouched for. A request that comes after its call ended has no context, and vouches for nothing.
export const vouch = (context: unknown, account: { id: number } | null) => {
  if (account && typeof context === 'object' && context !== null) (context as CallContext).vouched.add(account.id)
  return account
}

// Whether the call vouched for this account (accounts.create, checkPassword or findByLogin, in the same call).
export const vouchedFor = (context: CallContext, accountId: number) => context.vouched.has(accountId)

// Whom a plugin's password check counts against: the address its call came from, or the plugin itself.
export const clientOf = (context: unknown, pluginId: string) => {
  const client = typeof context === 'object' && context !== null ? (context as CallContext).client : undefined
  return typeof client === 'string' ? client : `plugin:${pluginId}`
}
