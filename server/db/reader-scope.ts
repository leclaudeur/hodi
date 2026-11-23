import { AsyncLocalStorage } from 'node:async_hooks'

// The accounts a request reads as: those signed in on its device. The profiles it sees are theirs and their children's
// (ProfileStore.list), never another account's. The session sets them once, and every await under the request keeps
// them.
const scope = new AsyncLocalStorage<readonly number[]>()

export const asReaders = <T>(accountIds: readonly number[], fn: () => T): T => scope.run(accountIds, fn)

// null outside a request (start-up, the nightly jobs, the signed-out pages): every profile.
export const currentReaders = (): readonly number[] | null => scope.getStore() ?? null
