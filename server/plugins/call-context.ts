import type { PluginAiStatus } from './ai.ts'

// What the call that led to a plugin's request was for: a person's request in the app, or nothing of the kind (a
// task, a hook, a feed, a public route, the server's own space).
export interface CallContext {
  // A person signed in on a device asked, with a profile open.
  forReader: boolean
  // The address the request came from, for the sign-in throttle; absent for a hook, which no request led to.
  client?: string
  // The accounts this call made, checked the password of or found by its login: the only ones its answer may sign in.
  vouched: Set<number>
  // A click on the plugin's AiButton (an aiAction call): who clicked, and whether its one question was asked.
  ai?: AiTicket
}

export interface AiTicket {
  profileId: number
  used: boolean
  outcome: PluginAiStatus | null
}

// A reader's request (ctx.articles) only runs for the call that made it: work a plugin left running after its call
// ended, or a call no reader made, is refused.
export const readerOnly = (context: unknown) => {
  const forReader = typeof context === 'object' && context !== null && (context as CallContext).forReader === true
  if (!forReader) throw new Error('no_reader')
}

export const callContext = (forReader = true, client?: string): CallContext => ({
  forReader,
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
