import { AsyncLocalStorage } from 'node:async_hooks'

// The household a request is for, read by the stores that hold one household's data (its profiles, its settings, its
// codes). The session decides it once, then every read and write under that request stays in it, through every
// await, without each route passing it along. The core has one household; a plugin may add others, and nothing in a
// request then reaches past its own.
// The household the core makes at its first start, and the only one it ever makes.
export const DEFAULT_ACCOUNT_ID = 1

const scope = new AsyncLocalStorage<number>()

// fn runs for that household, and so does everything it waits on.
export const inHousehold = <T>(householdId: number, fn: () => T): T => scope.run(householdId, fn)

// Outside a request (start-up, the nightly jobs), the first household: the only one the core makes.
export const currentHouseholdId = (): number => scope.getStore() ?? DEFAULT_ACCOUNT_ID
